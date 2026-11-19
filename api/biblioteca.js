import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET: Lista todos os livros ou reservas cadastradas
    if (req.method === 'GET') {
      const { tipo } = req.query; // 'livros' ou 'reservas'
      
      if (tipo === 'reservas') {
        const reservasKeys = await kv.keys('reserva:*');
        const reservas = [];
        for (const key of reservasKeys) {
          const item = await kv.get(key);
          reservas.push(item);
        }
        return res.status(200).json(reservas);
      }

      // Padrão: Retorna os livros
      const livrosKeys = await kv.keys('livro:*');
      const livros = [];
      for (const key of livrosKeys) {
        const item = await kv.get(key);
        livros.push(item);
      }
      return res.status(200).json(livros);
    }

    // POST: Cadastra livro, reserva ou devolve
    if (req.method === 'POST') {
      const { acao, titulo, autor, capa, categoria, codigo, leitor, turma, id } = req.body;

      // 1. Cadastrar livro (suporta tanto 'cadastrar' quanto 'cadastrar_livro')
      if (acao === 'cadastrar' || acao === 'cadastrar_livro') {
        if (!titulo || !autor) {
          return res.status(400).json({ erro: 'Título e Autor são obrigatórios!' });
        }
        const livroId = Date.now().toString();
        const novoLivro = {
          id: livroId,
          titulo,
          autor,
          capa: capa || '',
          categoria: categoria || 'Geral',
          codigo: codigo || '',
          disponivel: true
        };
        
        await kv.set(`livro:${livroId}`, novoLivro);
        return res.status(200).json({ mensagem: 'Livro cadastrado com sucesso!', livro: novoLivro });
      }

      // 2. Reservar / Emprestar livro
      if (acao === 'reservar') {
        const livroId = id || req.body.livroId;
        const nomeLeitor = leitor || req.body.nomeAluno;
        const turmaLeitor = turma || req.body.turma;

        if (!nomeLeitor || !turmaLeitor || !livroId) {
          return res.status(400).json({ erro: 'Nome, turma e ID do livro são obrigatórios!' });
        }

        const livroKey = `livro:${livroId}`;
        const livro = await kv.get(livroKey);

        if (!livro) {
          return res.status(404).json({ erro: 'Livro não encontrado!' });
        }

        livro.disponivel = false;
        livro.leitor = nomeLeitor;
        livro.turma = turmaLeitor;
        livro.dataReserva = new Date().toISOString();

        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Livro reservado com sucesso!', livro });
      }

      // 3. Devolver livro
      if (acao === 'devolver') {
        const livroId = id;
        if (!livroId) {
          return res.status(400).json({ erro: 'ID do livro é obrigatório para devolução!' });
        }

        const livroKey = `livro:${livroId}`;
        const livro = await kv.get(livroKey);

        if (!livro) {
          return res.status(404).json({ erro: 'Livro não encontrado!' });
        }

        livro.disponivel = true;
        delete livro.leitor;
        delete livro.turma;
        delete livro.dataReserva;

        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Livro devolvido ao acervo!', livro });
      }

      return res.status(400).json({ erro: 'Ação inválida!' });
    }

    return res.status(405).json({ erro: 'Método não permitido' });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
