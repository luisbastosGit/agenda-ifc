const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ################### PASSO IMPORTANTE ###################
// COLE O ID DA SUA PLANILHA V2 DENTRO DAS ASPAS ABAIXO
const ID_PLANILHA = "SEU_ID_DA_PLANILHA_V2_AQUI";
// ########################################################

// Pega as credenciais da variável de ambiente segura do Netlify
const credenciaisString = process.env.GOOGLE_CREDENTIALS;

exports.handler = async (event, context) => {
    try {
        // Verifica se as credenciais foram carregadas
        if (!credenciaisString) {
            throw new Error("Credenciais do Google não foram encontradas nas variáveis de ambiente.");
        }
        const credenciais = JSON.parse(credenciaisString);

        // Configura a autenticação
        const auth = new JWT({
            email: credenciais.client_email,
            // A linha abaixo é CRUCIAL para formatar a chave corretamente
            key: credenciais.private_key.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];

        // Se o pedido for do tipo GET (para listar agendamentos)
        if (event.httpMethod === 'GET') {
            const linhas = await abaAgendamentos.getRows();
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        // Se o pedido for do tipo POST (para adicionar um novo agendamento)
        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);
            const novaLinha = { 
                ID_Agendamento: "visita-" + new Date().getTime(), 
                Data_Solicitacao: new Date().toISOString(), 
                Status: "Pendente", 
                ...dados // Adiciona todos os outros dados do formulário
            };
            await abaAgendamentos.addRow(novaLinha);
            // Futuramente, adicionaremos o envio de e-mail aqui
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: "Agendamento recebido!" }) };
        }

    } catch (error) {
        console.error("Erro na função Netlify:", error.toString());
        return {
            statusCode: 500,
            body: JSON.stringify({ status: "erro", message: error.toString() })
        };
    }
};
