import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
  const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

  try {
    // ==========================================
    // GET: Consultas de dados
    // ==========================================
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

      if (tipo === 'profs_autorizados') {
        const lista = (await kv.get('config:profs_autorizados')) || [];
        return res.status(200).json(lista);
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

      // Padrão: livros
      const keys = await kv.keys('livro:*');
      const livros = [];
      for (const k of keys) {
        const item = await kv.get(k);
        if (item) livros.push(item);
      }
      return res.status(200).json(livros);
    }

    // ==========================================
    // POST: Ações do sistema
    // ==========================================
    if (req.method === 'POST') {
      const body = req.body;
      const { acao } = body;

      // 1. ENVIAR CÓDIGO DE VERIFICAÇÃO REAL POR E-MAIL
      if (acao === 'enviar_codigo_email') {
        const { email, nome } = body;
        if (!email) return res.status(400).json({ erro: 'Informe um e-mail válido.' });

        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        await kv.set(`verify:${email.toLowerCase().trim()}`, codigo, { ex: 900 }); // expira em 15 min

        if (!RESEND_API_KEY) {
          return res.status(200).json({
            enviado: false,
            modoSemChave: true,
            mensagem: 'Configure RESEND_API_KEY na Vercel para envio real de e-mail, ou prossiga criando seu PIN diretamente.'
          });
        }

        const mailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Biblioteca Getulio <onboarding@resend.dev>',
            to: [email.trim()],
            subject: `Seu código de acesso: ${codigo} — Biblioteca EMEF Getúlio Vargas`,
            html: `<div style="font-family:sans-serif;padding:20px;">
              <h2>Olá, ${nome || 'Leitor(a)'}!</h2>
              <p>Seu código de verificação para acessar a <strong>Biblioteca da EMEF Presidente Getúlio Vargas</strong> é:</p>
              <div style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f3e8ff;color:#6b21a8;padding:16px;border-radius:12px;display:inline-block;">${codigo}</div>
              <p style="color:#666;font-size:12px;margin-top:16px;">Este código expira em 15 minutos.</p>
            </div>`
          })
        });

        if (!mailRes.ok) {
          const errText = await mailRes.text();
          return res.status(500).json({ erro: 'Falha ao disparar e-mail: ' + errText });
        }

        return res.status(200).json({ enviado: true, mensagem: 'Código enviado para o seu e-mail!' });
      }

      // 2. CADASTRAR CONTA (ALUNO OU PROFESSOR AUTORIZADO)
      if (acao === 'registrar_usuario') {
        const { perfil, nome, turma, whatsapp, email, pin, codigoEmail } = body;
        const emailNorm = (email || '').toLowerCase().trim();

        if (!nome || !emailNorm || !pin) {
          return res.status(400).json({ erro: 'Nome, e-mail e PIN são obrigatórios.' });
        }

        // Se RESEND_API_KEY estiver ativa, exige o código enviado ao e-mail
        if (RESEND_API_KEY) {
          const codigoSalvo = await kv.get(`verify:${emailNorm}`);
          if (!codigoSalvo || String(codigoSalvo) !== String(codigoEmail).trim()) {
            return res.status(400).json({ erro: 'Código de verificação de e-mail inválido ou expirado.' });
          }
          await kv.del(`verify:${emailNorm}`);
        }

        // Se for professor, valida na lista de autorizados do Admin
        if (perfil === 'professor') {
          const autorizados = (await kv.get('config:profs_autorizados')) || [];
          const nomeNorm = nome.toLowerCase().trim();
          const permitido = autorizados.some(p =>
            (p.email && p.email.toLowerCase().trim() === emailNorm) ||
            (p.nome && p.nome.toLowerCase().trim() === nomeNorm)
          );
          if (!permitido) {
            return res.status(403).json({
              erro: 'Seu nome ou e-mail ainda não está na lista de professores autorizados pela biblioteca.'
            });
          }
        }

        const existente = await kv.get(`user:${emailNorm}`);
        if (existente) {
          return res.status(400).json({ erro: 'Este e-mail já possui cadastro. Faça login na aba Entrar.' });
        }

        const novoUsuario = {
          id: Date.now().toString(),
          perfil: perfil === 'professor' ? 'professor' : 'aluno',
          nome: nome.trim(),
          turma: perfil === 'professor' ? 'Docente' : (turma || '').trim(),
          whatsapp: (whatsapp || '').trim(),
          email: emailNorm,
          pin: String(pin).trim()
        };

        await kv.set(`user:${emailNorm}`, novoUsuario);
        const { pin: _, ...usuarioSeguro } = novoUsuario;
        return res.status(200).json({ usuario: usuarioSeguro });
      }

      // 3. LOGIN (ALUNO, PROFESSOR OU ADMIN)
      if (acao === 'login') {
        const { perfil, email, pin } = body;

        if (perfil === 'admin') {
          if (String(pin).trim() !== String(ADMIN_PIN)) {
            return res.status(403).json({ erro: 'PIN de Administrador incorreto.' });
          }
          return res.status(200).json({
            usuario: { id: 'admin', perfil: 'admin', nome: 'Administração da Biblioteca', email: 'admin@escola' }
          });
        }

        const emailNorm = (email || '').toLowerCase().trim();
        const user = await kv.get(`user:${emailNorm}`);
        if (!user || String(user.pin) !== String(pin).trim()) {
          return res.status(401).json({ erro: 'E-mail ou PIN incorretos.' });
        }

        const { pin: _, ...usuarioSeguro } = user;
        return res.status(200).json({ usuario: usuarioSeguro });
      }

      // 4. ADMIN: GERENCIAR PROFESSORES AUTORIZADOS
      if (acao === 'add_prof_autorizado') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Acesso restrito ao Admin.' });
        }
        const lista = (await kv.get('config:profs_autorizados')) || [];
        lista.push({
          id: Date.now().toString(),
          nome: (body.nome || '').trim(),
          email: (body.email || '').toLowerCase().trim()
        });
        await kv.set('config:profs_autorizados', lista);
        return res.status(200).json({ lista });
      }

      if (acao === 'del_prof_autorizado') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Acesso restrito ao Admin.' });
        }
        let lista = (await kv.get('config:profs_autorizados')) || [];
        lista = lista.filter(p => p.id !== body.id);
        await kv.set('config:profs_autorizados', lista);
        return res.status(200).json({ lista });
      }

      // 5. ADMIN: CADASTRAR LIVRO
      if (acao === 'cadastrar') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Somente o Admin pode cadastrar livros.' });
        }
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

      // 6. RESERVAR / RETIRAR LIVRO (ALUNO, PROFESSOR OU ADMIN)
      if (acao === 'reservar') {
        const livroKey = `livro:${body.id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });
        if (!livro.disponivel) return res.status(400).json({ erro: 'Este livro já está reservado ou emprestado.' });

        const diasPrazo = Number(body.prazoDias) || 7;
        const agora = new Date();
        const devolucao = new Date(agora.getTime() + diasPrazo * 24 * 60 * 60 * 1000);

        livro.disponivel = false;
        livro.statusEmprestimo = body.statusEmprestimo || 'RESERVADO'; // RESERVADO (aguardando retirada) | RETIRADO
        livro.leitor = body.leitor;
        livro.turma = body.turma || '';
        livro.emailLeitor = body.emailLeitor || '';
        livro.whatsappLeitor = body.whatsappLeitor || '';
        livro.dataReserva = agora.toISOString();
        livro.dataDevolucao = devolucao.toISOString();
        livro.prazoDias = diasPrazo;

        await kv.set(livroKey, livro);
        return res.status(200).json({ livro });
      }

      // 7. ADMIN: CONFIRMAR RETIRADA FÍSICA NA BIBLIOTECA
      if (acao === 'confirmar_retirada') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Somente o Admin pode confirmar retiradas.' });
        }
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

      // 8. ADMIN: DEVOLVER LIVRO
      if (acao === 'devolver') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Somente o Admin pode registrar devoluções.' });
        }
        const livroKey = `livro:${body.id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });

        livro.disponivel = true;
        delete livro.statusEmprestimo;
        delete livro.leitor;
        delete livro.turma;
        delete livro.emailLeitor;
        delete livro.whatsappLeitor;
        delete livro.dataReserva;
        delete livro.dataDevolucao;
        delete livro.prazoDias;

        await kv.set(livroKey, livro);
        return res.status(200).json({ livro });
      }

      // 9. ADMIN: CONFIGURAR AGENDA DO ESPAÇO FÍSICO (ABERTO, FECHADO, PERÍODOS, HORA DO CONTO)
      if (acao === 'configurar_espaco') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Somente o Admin pode alterar a agenda da biblioteca.' });
        }
        const espacoId = Date.now().toString();
        const slot = {
          id: espacoId,
          data: body.data,
          turno: body.turno, // Manhã | Tarde | Integral
          periodos: body.periodos, // Ex: "1º e 2º Períodos", "Todos os períodos", "Hora do Conto"
          status: body.status, // DISPONIVEL | FECHADO | ATIVIDADE_INTERNA
          observacao: body.observacao || '',
          prof: '',
          turma: ''
        };
        await kv.set(`espaco:${espacoId}`, slot);
        return res.status(200).json({ slot });
      }

      // 10. PROFESSOR: RESERVAR HORÁRIO DISPONÍVEL NO ESPAÇO
      if (acao === 'reservar_espaco') {
        const espacoKey = `espaco:${body.id}`;
        const slot = await kv.get(espacoKey);
        if (!slot || slot.status !== 'DISPONIVEL') {
          return res.status(400).json({ erro: 'Este horário não está disponível para reserva.' });
        }
        slot.status = 'RESERVADO';
        slot.prof = body.prof;
        slot.turma = body.turma;
        slot.atividade = body.atividade || '';
        await kv.set(espacoKey, slot);
        return res.status(200).json({ slot });
      }

      // 11. ADMIN: EXCLUIR REGISTRO (LIVRO, ALUNO OU HORÁRIO)
      if (acao === 'excluir') {
        if (String(body.adminPin) !== String(ADMIN_PIN)) {
          return res.status(403).json({ erro: 'Acesso negado: PIN de Administrador inválido.' });
        }
        const { tipoItem, itemId } = body;
        if (tipoItem === 'aluno') {
          await kv.del(`user:${itemId}`);
        } else {
          await kv.del(`${tipoItem}:${itemId}`);
        }
        return res.status(200).json({ mensagem: 'Excluído com sucesso!' });
      }

      return res.status(400).json({ erro: 'Ação inválida.' });
    }

    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
