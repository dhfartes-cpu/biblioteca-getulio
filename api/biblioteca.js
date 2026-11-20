import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // SENHA RIGOROSA DE ADMIN SOLICITADA
  const SENHA_ADMIN_MESTRE = "BiblioGetulio#2027@";

  try {
    // --- MODO GET: Buscar dados ---
    if (req.method === 'GET') {
      const tipo = req.query.tipo;

      if (tipo === 'usuarios') {
        let usuarios = [];
        try { usuarios = (await kv.get('biblioteca_usuarios')) || global.memUsuarios || []; } 
        catch (err) { usuarios = global.memUsuarios || []; }
        return res.status(200).json(usuarios);
      }

      if (tipo === 'espacos') {
        let espacos = [];
        try { espacos = (await kv.get('biblioteca_espacos')) || global.memEspacos || []; } 
        catch (err) { espacos = global.memEspacos || []; }
        return res.status(200).json(espacos);
      }

      if (tipo === 'eventos') {
        let eventos = [];
        try { eventos = (await kv.get('biblioteca_eventos')) || global.memEventos || []; } 
        catch (err) { eventos = global.memEventos || []; }
        return res.status(200).json(eventos);
      }

      // Acervo de livros
      let acervo = [];
      try { acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || []; } 
      catch (err) { acervo = global.memAcervo || []; }
      return res.status(200).json(acervo);
    }

    // --- MODO POST: Ações e Salvamentos ---
    if (req.method === 'POST') {
      const { acao, adminPin, ...dados } = req.body;

      // 1. REGISTRAR / CADASTRAR USUÁRIO
      if (acao === 'registrar_usuario') {
        let usuarios = [];
        try { usuarios = (await kv.get('biblioteca_usuarios')) || global.memUsuarios || []; } catch(e){}

        const novoUser = {
          id: 'user_' + Date.now(),
          perfil: dados.perfil || 'aluno',
          nome: dados.nome,
          turma: dados.turma || '',
          email: dados.email || '',
          whatsapp: dados.whatsapp || '',
          pin: dados.pin || '1234'
        };

        usuarios.push(novoUser);
        global.memUsuarios = usuarios;
        try { await kv.set('biblioteca_usuarios', usuarios); } catch(e){}

        return res.status(200).json({ sucesso: true, usuario: novoUser });
      }

      // 2. LOGIN DE USUÁRIO
      if (acao === 'login') {
        let usuarios = [];
        try { usuarios = (await kv.get('biblioteca_usuarios')) || global.memUsuarios || []; } catch(e){}

        const encontrado = usuarios.find(u => 
          u.perfil === dados.perfil && 
          u.nome.toLowerCase() === (dados.nome || '').toLowerCase() && 
          u.pin === dados.pin
        );

        if (!encontrado) {
          return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }

        return res.status(200).json({ sucesso: true, usuario: encontrado });
      }

      // 3. CADASTRAR NOVO LIVRO
      if (acao === 'cadastrar') {
        let acervo = [];
        try { acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || []; } catch(e){}

        const qtd = parseInt(dados.quantidade) || 1;
        const novoLivro = {
          id: 'livro_' + Date.now(),
          titulo: dados.titulo,
          autor: dados.autor,
          edicao: dados.edicao || '',
          ano: dados.ano || '',
          quantidadeTotal: qtd,
          quantidadeDisponivel: qtd,
          capa: dados.capa || '',
          pdf: dados.pdf || '',
          categoria: dados.categoria || 'Didático / Geral',
          codigo: dados.codigo || '',
          leitoresAtivos: []
        };

        acervo.push(novoLivro);
        global.memAcervo = acervo;
        try { await kv.set('biblioteca_acervo', acervo); } catch(e){}

        return res.status(200).json({ sucesso: true, livro: novoLivro });
      }

      // 4. EDITAR LIVRO
      if (acao === 'editar') {
        let acervo = [];
        try { acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || []; } catch(e){}

        const index = acervo.findIndex(l => l.id === dados.id);
        if (index !== -1) {
          if (dados.titulo) acervo[index].titulo = dados.titulo;
          if (dados.autor) acervo[index].autor = dados.autor;
          if (dados.edicao !== undefined) acervo[index].edicao = dados.edicao;
          if (dados.ano !== undefined) acervo[index].ano = dados.ano;
          if (dados.quantidade) {
            const novaQtd = parseInt(dados.quantidade);
            const diff = novaQtd - acervo[index].quantidadeTotal;
            acervo[index].quantidadeTotal = novaQtd;
            acervo[index].quantidadeDisponivel = Math.max(0, (acervo[index].quantidadeDisponivel || 0) + diff);
          }
          if (dados.capa !== undefined) acervo[index].capa = dados.capa;
          if (dados.pdf !== undefined) acervo[index].pdf = dados.pdf;
          if (dados.categoria) acervo[index].categoria = dados.categoria;
          if (dados.codigo !== undefined) acervo[index].codigo = dados.codigo;

          global.memAcervo = acervo;
          try { await kv.set('biblioteca_acervo', acervo); } catch(e){}
        }
        return res.status(200).json({ sucesso: true });
      }

      // 5. RESERVAR / AGENDAR / RETIRAR LIVRO
      if (acao === 'reservar') {
        let acervo = [];
        try { acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || []; } catch(e){}

        const index = acervo.findIndex(l => l.id === dados.id);
        if (index === -1) return res.status(404).json({ erro: 'Livro não encontrado.' });

        const livro = acervo[index];
        if (!livro.leitoresAtivos) livro.leitoresAtivos = [];

        const qtdTotal = livro.quantidadeTotal || 1;
        let qtdDisp = livro.quantidadeDisponivel !== undefined ? livro.quantidadeDisponivel : qtdTotal;

        if (qtdDisp <= 0) {
          return res.status(400).json({ erro: 'Livro esgotado.' });
        }

        const dias = parseInt(dados.prazoDias) || 7;
        const dataDevolucao = new Date();
        dataDevolucao.setDate(dataDevolucao.getDate() + dias);

        const novoEmprestimo = {
          leitor: dados.leitor,
          turma: dados.turma || 'Docente',
          whatsappLeitor: dados.whatsappLeitor || '',
          dataRetirada: new Date().toISOString(),
          dataDevolucao: dataDevolucao.toISOString(),
          statusEmprestimo: dados.statusEmprestimo || 'RETIRADO',
          observacao: dados.observacao || ''
        };

        livro.leitoresAtivos.push(novoEmprestimo);
        
        if (novoEmprestimo.statusEmprestimo === 'RETIRADO') {
          livro.quantidadeDisponivel = Math.max(0, qtdDisp - 1);
        }

        global.memAcervo = acervo;
        try { await kv.set('biblioteca_acervo', acervo); } catch(e){}

        return res.status(200).json({ sucesso: true, livro });
      }

      // 6. DEVOLVER LIVRO
      if (acao === 'devolver') {
        let acervo = [];
        try { acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || []; } catch(e){}

        const index = acervo.findIndex(l => l.id === dados.id);
        if (index !== -1) {
          const livro = acervo[index];
          if (livro.leitoresAtivos && livro.leitoresAtivos.length > 0) {
            livro.leitoresAtivos.shift();
            const qtdTotal = livro.quantidadeTotal || 1;
            let qtdDisp = livro.quantidadeDisponivel !== undefined ? livro.quantidadeDisponivel : 0;
            livro.quantidadeDisponivel = Math.min(qtdTotal, qtdDisp + 1);

            global.memAcervo = acervo;
            try { await kv.set('biblioteca_acervo', acervo); } catch(e){}
          }
        }
        return res.status(200).json({ sucesso: true });
      }

      // 7. CONFIGURAR ESPAÇO
      if (acao === 'configurar_espaco') {
        let espacos = [];
        try { espacos = (await kv.get('biblioteca_espacos')) || global.memEspacos || []; } catch(e){}

        const novoSlot = {
          id: 'esp_' + Date.now(),
          data: dados.data,
          turno: dados.turno,
          periodos: dados.periodos,
          status: 'DISPONIVEL',
          prof: '',
          turma: ''
        };

        espacos.push(novoSlot);
        global.memEspacos = espacos;
        try { await kv.set('biblioteca_espacos', espacos); } catch(e){}

        return res.status(200).json({ sucesso: true, slot: novoSlot });
      }

      // 8. RESERVAR ESPAÇO (PROFESSOR)
      if (acao === 'reservar_espaco') {
        let espacos = [];
        try { espacos = (await kv.get('biblioteca_espacos')) || global.memEspacos || []; } catch(e){}

        const index = espacos.findIndex(s => s.id === dados.id);
        if (index !== -1) {
          espacos[index].status = 'RESERVADO';
          espacos[index].prof = dados.prof;
          espacos[index].turma = dados.turma;
          espacos[index].periodos = dados.periodos;

          global.memEspacos = espacos;
          try { await kv.set('biblioteca_espacos', espacos); } catch(e){}
        }
        return res.status(200).json({ sucesso: true });
      }

      // 9. SALVAR EVENTO / MURAL
      if (acao === 'salvar_evento') {
        let eventos = [];
        try { eventos = (await kv.get('biblioteca_eventos')) || global.memEventos || []; } catch(e){}

        const novoEvt = {
          id: 'evt_' + Date.now(),
          data: dados.data,
          titulo: dados.titulo,
          descricao: dados.descricao
        };

        eventos.push(novoEvt);
        global.memEventos = eventos;
        try { await kv.set('biblioteca_eventos', eventos); } catch(e){}

        return res.status(200).json({ sucesso: true, evento: novoEvt });
      }

      // 10. EXCLUIR REGISTRO (LIVRO, ESPAÇO, EVENTO OU USUÁRIO) COM VALIDAÇÃO DA SENHA MESTRE
      if (acao === 'excluir') {
        if (adminPin !== SENHA_ADMIN_MESTRE) {
          return res.status(401).json({ erro: 'Senha de Administrador incorreta.' });
        }

        const tipo = dados.tipoItem;
        const id = dados.itemId;

        if (tipo === 'livro') {
          let acervo = (await kv.get('biblioteca_acervo')) || global.memAcervo || [];
          acervo = acervo.filter(l => l.id !== id);
          global.memAcervo = acervo;
          try { await kv.set('biblioteca_acervo', acervo); } catch(e){}
        } else if (tipo === 'espaco') {
          let espacos = (await kv.get('biblioteca_espacos')) || global.memEspacos || [];
          espacos = espacos.filter(s => s.id !== id);
          global.memEspacos = espacos;
          try { await kv.set('biblioteca_espacos', espacos); } catch(e){}
        } else if (tipo === 'evento') {
          let eventos = (await kv.get('biblioteca_eventos')) || global.memEventos || [];
          eventos = eventos.filter(e => e.id !== id);
          global.memEventos = eventos;
          try { await kv.set('biblioteca_eventos', eventos); } catch(e){}
        } else if (tipo === 'usuario') {
          let usuarios = (await kv.get('biblioteca_usuarios')) || global.memUsuarios || [];
          usuarios = usuarios.filter(u => u.id !== id);
          global.memUsuarios = usuarios;
          try { await kv.set('biblioteca_usuarios', usuarios); } catch(e){}
        }

        return res.status(200).json({ sucesso: true });
      }

      return res.status(400).json({ erro: 'Ação desconhecida.' });
    }

    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({ erro: 'Erro interno no servidor', detalhes: error.message });
  }
}
