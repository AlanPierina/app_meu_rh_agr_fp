const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Upload de Arquivos e Fotos
const upload = multer({ dest: 'uploads/' });

// Inicialização do Banco de Dados SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Erro ao abrir o banco de dados', err.message);
    else console.log('Conectado ao banco de dados SQLite.');
});

// Criar tabela de colaboradores e administradores
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS colaboradores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cpf TEXT UNIQUE,
        nome TEXT,
        funcao TEXT,
        senha TEXT,
        foto TEXT,
        is_admin INTEGER DEFAULT 0
    )`);
});

// Rota para importar a planilha em lote (Lê os 172 colaboradores automaticamente)
app.post('/api/importar-lote', upload.single('arquivoExcel'), (req, res) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const dadosPlanilha = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        let importados = 0;
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // Inserir usuário admin padrão se não existir
            db.run(`INSERT OR IGNORE INTO colaboradores (cpf, nome, funcao, senha, is_admin) VALUES (?, ?, ?, ?, ?)`, 
                ['000.000.000-00', 'Administrador Master', 'Admin', 'admin123', 1]);

            dadosPlanilha.forEach(row => {
                // Ajusta os nomes das colunas conforme a planilha
                let cpfBruto = String(row['CPF'] || '').trim();
                let nome = String(row['Colaborador '] || row['Colaborador'] || '').trim();
                let funcao = String(row['Função'] || '').trim();

                if (cpfBruto && nome) {
                    // Limpa o CPF para formato padrão ou armazena limpo
                    let senhaPadrao = cpfBruto.replace(/\D/g, '').slice(0, 6); // 6 primeiros dígitos como senha inicial
                    
                    db.run(`INSERT OR REPLACE INTO colaboradores (cpf, nome, funcao, senha, is_admin) VALUES (?, ?, ?, ?, 0)`,
                        [cpfBruto, nome, funcao, senhaPadrao]);
                    importados++;
                }
            });

            db.run("COMMIT", (err) => {
                if (err) {
                    return res.status(500).json({ erro: 'Erro ao salvar no banco.' });
                }
                res.json({ mensagem: `Sucesso! ${importados} colaboradores importados.` });
            });
        });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao processar o arquivo Excel: ' + e.message });
    }
});

// Rota de Login (Trata CPF com ou sem pontuação)
app.post('/api/login', (req, res) => {
    let { cpf, senha } = req.body;
    if (!cpf || !senha) return res.status(400).json({ erro: 'Informe CPF e senha.' });

    // Remove formatação para buscar flexível no banco
    let cpfLimpo = cpf.replace(/\D/g, '');

    db.all(`SELECT * FROM colaboradores`, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: 'Erro no servidor.' });

        // Encontra o usuário comparando os CPFs sem caracteres especiais
        const usuario = rows.find(u => u.cpf.replace(/\D/g, '') === cpfLimpo);

        if (!usuario || usuario.senha !== senha) {
            return res.status(401).json({ erro: 'CPF ou senha inválidos.' });
        }

        res.json({
            mensagem: 'Login realizado com sucesso!',
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                funcao: usuario.funcao,
                cpf: usuario.cpf,
                foto: usuario.foto,
                is_admin: usuario.is_admin
            }
        });
    });
});

// Rota para o Admin visualizar todos os cadastros e senhas
app.get('/api/admin/colaboradores', (req, res) => {
    db.all(`SELECT id, cpf, nome, funcao, senha, is_admin FROM colaboradores`, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: 'Erro ao buscar dados.' });
        res.json(rows);
    });
});

// Rota para o Admin resetar a senha de um colaborador
app.post('/api/admin/resetar-senha', (req, res) => {
    const { id, novaSenha } = req.body;
    db.run(`UPDATE colaboradores SET senha = ? WHERE id = ?`, [novaSenha, id], function(err) {
        if (err) return res.status(500).json({ erro: 'Erro ao resetar senha.' });
        res.json({ mensagem: 'Senha resetada com sucesso!' });
    });
});

// Rota para atualizar foto de perfil
app.post('/api/usuario/foto', upload.single('foto'), (req, res) => {
    const { id } = req.body;
    const caminhoFoto = req.file ? `/uploads/${req.file.filename}` : null;

    if (!caminhoFoto) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });

    db.run(`UPDATE colaboradores SET foto = ? WHERE id = ?`, [caminhoFoto, id], function(err) {
        if (err) return res.status(500).json({ erro: 'Erro ao atualizar foto.' });
        res.json({ mensagem: 'Foto atualizada com sucesso!', foto: caminhoFoto });
    });
});

// Servir arquivos de uploads de fotos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});