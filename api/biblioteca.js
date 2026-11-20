import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { tipo } = req.query;

  try {
    if (req.method === 'GET') {
      if (tipo === 'usuarios') {
        const usuarios = (await kv.get('bib_usuarios')) || [];
        return res.status(200).json(usuarios);
      }
      if (tipo === 'espacos') {
        const espacos = (await kv.get('bib_espacos')) || [];
        return res.status(200).json(espacos);
      }
      if (tipo === 'eventos') {
        const eventos = (await kv.get('bib_eventos')) || [];
        return res.status(200).json(eventos);
      }

      const livros = (await kv.get('bib_livros')) || [];
      return res.status(200).json(livros);
    }

    if (req.method === 'POST') {
      const body = req.body;
      const acao = body.acao;

      if (acao === 'cadastrar') {
        const livros = (await kv.get('bib_livros')) || [];
        const novoLivro = {
          id: 'livro_' + Date.now(),
          titulo: body.titulo || 'Sem Título',
          autor: body.autor || 'Desconhecido',
          capa: body.capa || '',
          categoria: body.categoria || 'Geral',
          codigo: body.codigo || 'S/N',
          edicao: body.edicao || '',
          ano: body.ano || '',
          disponivel: true,
          leitor: null,
          turma: null,
          whatsappLeitor: null,
          dataReserva: null,
          dataDevolucao: null
        };
        livros.unshift(novoLivro);
        await kv.set('bib_livros', livros);
        return res.status(200).json({ sucesso: true, livro: novoLivro });
      }

      if (acao === 'editar') {
        const livros = (await kv.get('bib_livros')) || [];
        const index = livros.findIndex(l => l.id === body.id);
        if (index === -1) return res.status(404).json({ erro: 'Livro não encontrado.' });

        livros[index] = {
          ...livros[index],
          titulo: body.titulo || livros[index].titulo,
          autor: body.autor || livros[index].autor,
          capa: body.capa !== undefined ? body.capa : livros[index].capa,
          categoria: body.categoria || livros[index].categoria,
          codigo: body.codigo || livros[index].codigo,
          edicao: body.edicao !== undefined ? body.edicao : livros[index].edicao,
          ano: body.ano !== undefined ? body.ano : livros[index].ano
        };

        await kv.set('bib_livros', livros);
        return res.status(200).json({ sucesso: true, livro: livros[index] });
      }

      if (acao === 'registrar_usuario') {
        const usuarios = (await kv.get('bib_usuarios')) || [];
        const existente = usuarios.find(u => u.nome.toLowerCase() === body.nome.toLowerCase() && u.perfil === body.perfil);
        
        if (existente) {
          existente.turma = body.turma || existente.turma;
          existente.email = body.email || existente.email;
          existente.whatsapp = body.whatsapp || existente.whatsapp;
          existente.pin = body.pin || existente.pin;
        } else {
          usuarios.push({
            id: 'user_' + Date.now(),
            perfil: body.perfil,
            nome: body.nome,
            turma: body.turma || 'Docente',
            email: body.email || '',
            whatsapp: body.whatsapp || '',
            pin: body.pin || '1234'
          });
        }
        await kv.set('bib_usuarios', usuarios);
        return res.status(200).json({ sucesso: true, usuario: body });
      }

      if (acao === 'login') {
        const usuarios = (await kv.get('bib_usuarios')) || [];
        const user = usuarios.find(u => u.nome.toLowerCase() === body.nome.toLowerCase() && u.pin === body.pin);
        if (!user) return res.status(401).json({ erro: 'Usuário ou PIN incorreto.' });
        return res.status(200).json({ sucesso: true, usuario: user });
      }

      if (acao === 'reservar') {
        const livros = (await kv.get('bib_livros')) || [];
        const livro = livros.find(l => l.id === body.id);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });

        const hoje = new Date();
        const devolucao = new Date();
        devolucao.setDate(hoje.getDate() + (body.prazoDias || 7));

        livro.disponivel = false;
        livro.leitor = body.leitor;
        livro.turma = body.turma;
        livro.whatsappLeitor = body.whatsappLeitor;
        livro.statusEmprestimo = body.statusEmprestimo || 'RESERVADO';
        livro.dataReserva = hoje.toISOString();
        livro.dataDevolucao = devolucao.toISOString();

        await kv.set('bib_livros', livros);
        return res.status(200).json({ sucesso: true, livro });
      }

      if (acao === 'devolver') {
        const livros = (await kv.get('bib_livros')) || [];
        const livro = livros.find(l => l.id === body.id);
        if (livro) {
          livro.disponivel = true;
          livro.leitor = null;
          livro.turma = null;
          livro.whatsappLeitor = null;
          livro.statusEmprestimo = null;
          livro.dataReserva = null;
          livro.dataDevolucao = null;
          await kv.set('bib_livros', livros);
        }
        return res.status(200).json({ sucesso: true });
      }

      if (acao === 'configurar_espaco') {
        const espacos = (await kv.get('bib_espacos')) || [];
        espacos.unshift({
          id: 'esp_' + Date.now(),
          data: body.data,
          turno: body.turno,
          periodos: body.periodos,
          status: 'DISPONIVEL',
          prof: null,
          turma: null
        });
        await kv.set('bib_espacos', espacos);
        return res.status(200).json({ sucesso: true });
      }

      if (acao === 'reservar_espaco') {
        const espacos = (await kv.get('bib_espacos')) || [];
        const esp = espacos.find(e => e.id === body.id);
        if (esp) {
          esp.status = 'RESERVADO';
          esp.prof = body.prof;
          esp.turma = body.turma;
          esp.periodos = body.periodos;
          await kv.set('bib_espacos', espacos);
        }
        return res.status(200).json({ sucesso: true });
      }

      if (acao === 'salvar_evento') {
        const eventos = (await kv.get('bib_eventos')) || [];
        eventos.unshift({
          id: 'evt_' + Date.now(),
          data: body.data,
          titulo: body.titulo,
          descricao: body.descricao
        });
        await kv.set('bib_eventos', eventos);
        return res.status(200).json({ sucesso: true });
      }

      if (acao === 'excluir') {
        if (body.tipoItem === 'livro') {
          let livros = (await kv.get('bib_livros')) || [];
          livros = livros.filter(l => l.id !== body.itemId);
          await kv.set('bib_livros', livros);
        } else if (body.tipoItem === 'espaco') {
          let espacos = (await kv.get('bib_espacos')) || [];
          espacos = espacos.filter(e => e.id !== body.itemId);
          await kv.set('bib_espacos', espacos);
        } else if (body.tipoItem === 'evento') {
          let eventos = (await kv.get('bib_eventos')) || [];
          eventos = eventos.filter(ev => ev.id !== body.itemId);
          await kv.set('bib_eventos', eventos);
        } else if (body.tipoItem === 'aluno') {
          let usuarios = (await kv.get('bib_usuarios')) || [];
          usuarios = usuarios.filter(u => u.nome !== body.itemId);
          await kv.set('bib_usuarios', usuarios);
        }
        return res.status(200).json({ sucesso: true });
      }
    }

    return res.status(400).json({ erro: 'Requisição inválida.' });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
