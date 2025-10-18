const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ################### PASSO IMPORTANTE ###################
// COLE O ID DA SUA PLANILHA V2 DENTRO DAS ASPAS ABAIXO
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";
// ########################################################

// Pega o "envelope" Base64 da variável de ambiente
const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;

exports.handler = async (event, context) => {
    try {
        // Verifica se o envelope foi encontrado
        if (!credenciaisBase64) {
            throw new Error("Credenciais do Google (Base64) não foram encontradas.");
        }

        // Abre o envelope: decodifica o Base64 de volta para o formato JSON original
        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);

        // O resto do código continua como antes
        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key, // Não precisa mais do .replace()
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];

        if (event.httpMethod === 'GET') {
            const linhas = await abaAgendamentos.getRows();
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);
            const novaLinha = { 
                ID_Agendamento: "visita-" + new Date().getTime(), 
                Data_Solicitacao: new Date().toISOString(), 
                Status: "Pendente", 
                ...dados
            };
            await abaAgendamentos.addRow(novaLinha);
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
