import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

  try {
    if (req.method === 'GET') {
      const { tipo } = req.query;

      if (tipo === 'usuarios') {
        const keys = await kv.keys('user:*');
        const users = [];
        for (const k of keys) {
          const u = await kv.get(k);
          if (u) {
            const { pin, ...semPin } = u;
            users.push(semPin);
          }
        }
        return res.status(200).json(users);
      }

      if (tipo === 'espacos') {
        const keys = await kv.keys('espaco:*');
        const espacos = [];
        for (const k of keys) {
          const item = await kv.get(k);
          if (item) espacos.push(item);
        }
        espacos.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        return res.status(200).json(espacos);
      }

      const keys = await kv.keys('livro:*');
      const livros = [];
      for (const k of keys) {
        const item = await kv.get(k);
        if (item) livros.push(item);
      }
      return res.status(200).json(livros);
    }

    if (req.method === 'POST') {
      const body = req.body;
      const { acao } = body;

      // 1. REGISTRAR USUÁRIO (ALUNO, PROFESSOR OU ADMIN)
      if (acao === 'registrar_usuario') {
        const { perfil, nome, turma, whatsapp, pin } = body;
        const nomeNorm = (nome || '').trim();

        if (!nomeNorm || !pin) {
          return res.status(400).json({ erro: 'Nome e PIN são obrigatórios.' });
        }

        const chaveUser = `user:${nomeNorm.toLowerCase()}`;
        const existente = await kv.get(chaveUser);
        if (existente) {
          return res.status(400).json({ erro: 'Este nome já possui cadastro. Faça login na aba Entrar.' });
        }

        const novoUsuario = {
          id: Date.now().toString(),
          perfil: perfil === 'professor' ? 'professor' : (perfil === 'admin' ? 'admin' : 'aluno'),
          nome: nomeNorm,
          turma: perfil === 'professor' || perfil === 'admin' ? 'Docente / Admin' : (turma || '').trim(),
          whatsapp: (whatsapp || '').trim(),
          pin: String(pin).trim()
        };

        await kv.set(chaveUser, novoUsuario);
        const { pin: _, ...usuarioSeguro } = novoUsuario;
        return res.status(200).json({ usuario: usuarioSeguro });
      }

      // 2. LOGIN (ALUNO, PROFESSOR OU ADMIN)
      if (acao === 'login') {
        const { perfil, nome, pin } = body;

        if (perfil === 'admin') {
          if (String(pin).trim() !== String(ADMIN_PIN)) {
            return res.status(403).json({ erro: 'PIN de Administrador incorreto.' });
          }
          return res.status(200).json({
            usuario: { id: 'admin', perfil: 'admin', nome: 'Administração da Biblioteca', turma: 'Admin' }
          });
        }

        const nomeNorm = (nome || '').trim().toLowerCase();
        const user = await kv.get(`user:${nomeNorm}`);
        if (!user || String(user.pin) !== String(pin).trim()) {
          return res.status(401).json({ erro: 'Nome ou PIN incorretos.' });
        }

        const { pin: _, ...usuarioSeguro } = user;
        return res.status(200).json({ usuario: usuarioSeguro });
      }

      // 3. ADMIN: CADASTRAR LIVRO
      if (acao === 'cadastrar') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) return res.status(403).json({ erro: 'Acesso negado.' });
        const livroId = Date.now().toString();
        const novoLivro = {
          id: livroId,
          titulo: body.titulo,
          autor: body.autor,
          capa: body.capa || '',
          categoria: body.categoria || 'Geral',
          codigo: body.codigo || '',
          disponivel: true
        };
        await kv.set(`livro:${livroId}`, novoLivro);
        return res.status(200).json({ livro: novoLivro });
      }

      // 4. RESERVAR / RETIRAR LIVRO
      if (acao === 'reservar') {
        const livroKey = `livro:${body.id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });
        if (!livro.disponivel) return res.status(400).json({ erro: 'Este livro já está indisponível.' });

        const diasPrazo = Number(body.prazoDias) || 7;
        const agora = new Date();
        const devolucao = new Date(agora.getTime() + diasPrazo * 24 * 60 * 60 * 1000);

        livro.disponivel = false;
        livro.statusEmprestimo = body.statusEmprestimo || 'RESERVADO';
        livro.leitor = body.leitor;
        livro.turma = body.turma || '';
        livro.whatsappLeitor = body.whatsappLeitor || '';
        livro.dataReserva = agora.toISOString();
        livro.dataDevolucao = devolucao.toISOString();
        livro.prazoDias = diasPrazo;

        await kv.set(livroKey, livro);
        return res.status(200).json({ livro });
      }

      // 5. ADMIN: CONFIRMAR RETIRADA
      if (acao === 'confirmar_retirada') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) return res.status(403).json({ erro: 'Acesso negado.' });
        const livroKey = `livro:${body.id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });

        const diasPrazo = Number(body.prazoDias) || livro.prazoDias || 7;
        const agora = new Date();
        const devolucao = new Date(agora.getTime() + diasPrazo * 24 * 60 * 60 * 1000);

        livro.statusEmprestimo = 'RETIRADO';
        livro.dataReserva = agora.toISOString();
        livro.dataDevolucao = devolucao.toISOString();
        livro.prazoDias = diasPrazo;

        await kv.set(livroKey, livro);
        return res.status(200).json({ livro });
      }

      // 6. ADMIN: DEVOLVER LIVRO
      if (acao === 'devolver') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) return res.status(403).json({ erro: 'Acesso negado.' });
        const livroKey = `livro:${body.id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });

        livro.disponivel = true;
        delete livro.statusEmprestimo;
        delete livro.leitor;
        delete livro.turma;
        delete livro.whatsappLeitor;
        delete livro.dataReserva;
        delete livro.dataDevolucao;
        delete livro.prazoDias;

        await kv.set(livroKey, livro);
        return res.status(200).json({ livro });
      }

      // 7. ADMIN: CONFIGURAR AGENDA DO ESPAÇO
      if (acao === 'configurar_espaco') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) return res.status(403).json({ erro: 'Acesso negado.' });
        const espacoId = Date.now().toString();
        const slot = {
          id: espacoId,
          data: body.data,
          turno: body.turno,
          periodos: body.periodos,
          status: body.status,
          observacao: body.observacao || '',
          prof: '',
          turma: ''
        };
        await kv.set(`espaco:${espacoId}`, slot);
        return res.status(200).json({ slot });
      }

      // 8. PROFESSOR: RESERVAR ESPAÇO
      if (acao === 'reservar_espaco') {
        const espacoKey = `espaco:${body.id}`;
        const slot = await kv.get(espacoKey);
        if (!slot || slot.status !== 'DISPONIVEL') return res.status(400).json({ erro: 'Horário indisponível.' });
        slot.status = 'RESERVADO';
        slot.prof = body.prof;
        slot.turma = body.turma;
        slot.atividade = body.atividade || '';
        await kv.set(espacoKey, slot);
        return res.status(200).json({ slot });
      }

      // 9. ADMIN: EXCLUIR REGISTRO
      if (acao === 'excluir') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) return res.status(403).json({ erro: 'PIN incorreto.' });
        const { tipoItem, itemId } = body;
        if (tipoItem === 'aluno') {
          await kv.del(`user:${itemId.toLowerCase()}`);
        } else {
          await kv.del(`${tipoItem}:${itemId}`);
        }
        return res.status(200).json({ mensagem: 'Excluído!' });
      }

      return res.status(400).json({ erro: 'Ação inválida.' });
    }

    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
