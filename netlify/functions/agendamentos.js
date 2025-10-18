const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ################### PASSO IMPORTANTE ###################
// CONFIRME SE O ID DA SUA PLANILHA V2 ESTÁ CORRETO
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI";
// ########################################################

// Pega o "envelope" Base64 da variável de ambiente
const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;

// Funções de e-mail (agora incluídas para o POST)
// Para usar o Gmail, precisaremos de uma nova biblioteca. Por enquanto, vamos deixar a lógica pronta.
// O envio de e-mail via Node.js requer mais configuração, vamos focar em salvar os dados primeiro.

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
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo();
        const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];

        // Se o pedido for do tipo GET (para listar agendamentos no painel de admin)
        if (event.httpMethod === 'GET') {
            const linhas = await abaAgendamentos.getRows();
            const agendamentos = linhas.map(linha => linha.toObject());
            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
        }

        // Se o pedido for do tipo POST (para adicionar um novo agendamento do index.html)
        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body);

            // Monta o objeto da nova linha com os dados recebidos
            const novaLinha = { 
                ID_Agendamento: "visita-" + new Date().getTime(), 
                Data_Solicitacao: new Date().toISOString(), 
                Status: "Pendente", 
                Data_Visita: dados.dataVisita,
                Periodo: dados.periodo,
                Nome_Escola: dados.nomeEscola,
                Cidade_Escola: dados.cidadeEscola,
                Nome_Responsavel: dados.nomeResponsavel,
                Telefone_Responsavel: dados.telefoneResponsavel,
                Email_Responsavel: dados.emailResponsavel,
                Qtd_Alunos: dados.qtdAlunos,
                Faixa_Etaria: dados.faixaEtaria,
                Ano_Letivo: dados.anoLetivo,
                Objetivo_Visita: dados.objetivoVisita,
                Pretende_Almocar: dados.pretendeAlmocar,
                Observacoes: dados.observacoes
            };

            await abaAgendamentos.addRow(novaLinha);

            // NOTA: O envio de e-mails será nossa próxima etapa, pois requer uma configuração adicional (Nodemailer).
            // Por enquanto, nosso foco é garantir que os dados sejam salvos corretamente.

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
