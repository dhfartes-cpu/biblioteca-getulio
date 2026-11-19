import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET: Lista livros, alunos ou espaços
    if (req.method === 'GET') {
      const { tipo } = req.query; // 'livros', 'alunos', 'espacos'
      
      let prefixo = 'livro:*';
      if (tipo === 'alunos') prefixo = 'aluno:*';
      if (tipo === 'espacos') prefixo = 'espaco:*';

      const keys = await kv.keys(prefixo);
      const itens = [];
      for (const key of keys) {
        const item = await kv.get(key);
        itens.push(item);
      }
      return res.status(200).json(itens);
    }

    // POST: Ações de cadastro, empréstimo, devolução e exclusão
    if (req.method === 'POST') {
      const { acao, id, titulo, autor, capa, categoria, codigo, leitor, turma, contato, prof, data, horario, email } = req.body;

      // 1. Cadastrar Livro
      if (acao === 'cadastrar') {
        const livroId = id || Date.now().toString();
        const novoLivro = { id: livroId, titulo, autor, capa: capa || '', categoria: categoria || 'Geral', codigo: codigo || '', disponivel: true };
        await kv.set(`livro:${livroId}`, novoLivro);
        return res.status(200).json({ mensagem: 'Livro salvo!', livro: novoLivro });
      }

      // 2. Emprestar / Reservar Livro
      if (acao === 'reservar') {
        const livroKey = `livro:${id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado' });

        livro.disponivel = false;
        livro.leitor = leitor;
        livro.turma = turma;
        livro.dataReserva = new Date().toISOString();
        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Empréstimo registrado!', livro });
      }

      // 3. Devolver Livro
      if (acao === 'devolver') {
        const livroKey = `livro:${id}`;
        const livro = await kv.get(livroKey);
        if (!livro) return res.status(404).json({ erro: 'Livro não encontrado' });

        livro.disponivel = true;
        delete livro.leitor;
        delete livro.turma;
        delete livro.dataReserva;
        await kv.set(livroKey, livro);
        return res.status(200).json({ mensagem: 'Devolução registrada!', livro });
      }

      // 4. Cadastrar Aluno
      if (acao === 'cadastrar_aluno') {
        const alunoId = Date.now().toString();
        const novoAluno = { id: alunoId, nome: leitor || req.body.nome, turma, contato: contato || '' };
        await kv.set(`aluno:${alunoId}`, novoAluno);
        return res.status(200).json({ mensagem: 'Aluno salvo!', aluno: novoAluno });
      }

      // 5. Agendar Espaço Físico
      if (acao === 'agendar_espaco') {
        const espacoId = Date.now().toString();
        const novoEspaco = { id: espacoId, prof, turma, data, horario };
        await kv.set(`espaco:${espacoId}`, novoEspaco);
        return res.status(200).json({ mensagem: 'Espaço agendado!', espaco: novoEspaco });
      }

      // 6. Excluir Item (Livro, Aluno ou Espaço)
      if (acao === 'excluir') {
        const { tipoItem, itemId } = req.body;
        await kv.del(`${tipoItem}:${itemId}`);
        return res.status(200).json({ mensagem: 'Excluído com sucesso!' });
      }

      return res.status(400).json({ erro: 'Ação inválida' });
    }

    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
