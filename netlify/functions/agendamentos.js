const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ID da sua planilha V2
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";

// Pega as credenciais da variável de ambiente do Netlify
const credenciaisString = process.env.GOOGLE_CREDENTIALS;

exports.handler = async (event, context) => {
    try {
        if (!credenciaisString) {
            throw new Error("Credenciais do Google não encontradas.");
        }
        // Converte a string de volta para um objeto JSON
        const credenciais = JSON.parse(credenciaisString);

        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];

        const dados = JSON.parse(event.body || '{}');

        if (event.httpMethod === 'GET') { // Modificado para funcionar com GET para listar
            const linhas = await abaAgendamentos.getRows();
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        } 

        if (event.httpMethod === 'POST') {
            const novaLinha = { ID_Agendamento: "visita-" + new Date().getTime(), Data_Solicitacao: new Date().toISOString(), Status: "Pendente", ...dados };
            await abaAgendamentos.addRow(novaLinha);
            // Lógica de e-mail virá depois
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", message: "Agendamento recebido!" }) };
        }

    } catch (error) {
        console.error("Erro na função Netlify:", error);
        return { statusCode: 500, body: JSON.stringify({ status: "erro", message: error.message }) };
    }
};
