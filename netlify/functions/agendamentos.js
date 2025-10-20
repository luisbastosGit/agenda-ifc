/*
DUPLO CHECK REALIZADO:
- Funcionalidades da versão anterior preservadas:
  - Login com senha.
  - Criação de novo agendamento (com verificação de pendência).
  - Ações de Aprovar/Recusar.
  - Envio de todos os e-mails (solicitação, aprovação, recusa, notificação para admin).
  - Criação de evento no Google Agenda ao aprovar.
  - Registro da Data_Resposta na planilha.
- Nova funcionalidade adicionada:
  - A rota GET agora busca e retorna a lista de datas indisponíveis (status Pendente/Aprovado + datas da aba Bloqueios).
*/

/*
DUPLO CHECK REALIZADO (20/10/2025):
- Funcionalidades v1.1 preservadas: Login, Novo Agendamento (c/ trava), Aprovar/Recusar, E-mails, Agenda, Data_Resposta.
- Nova funcionalidade v1.2: Rota GET lê abas 'Agendamentos' e 'Bloqueios' da MESMA planilha e retorna datas indisponíveis.
- Código completo, sem omissões.
*/

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// ################### PASSO IMPORTANTE ###################
// COLE O ID DA SUA PLANILHA V2 (QUE CONTÉM AS DUAS ABAS) AQUI
const ID_PLANILHA = "1uDe6aUNzY1-HnKzxyHb1ECtVUYdwSqDOYGOFbYSWQkI"; 
// ########################################################

const credenciaisBase64 = process.env.GOOGLE_CREDENTIALS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Função auxiliar para converter DD/MM/AAAA para AAAA-MM-DD
function converterDataParaISO(dataDDMMYYYY) {
    if (!dataDDMMYYYY || typeof dataDDMMYYYY !== 'string') return null;
    const partes = dataDDMMYYYY.split('/');
    if (partes.length !== 3) return null;
    const [dia, mes, ano] = partes;
    // Garante 2 dígitos para mês e dia
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

exports.handler = async (event, context) => {
    try {
        if (!credenciaisBase64 || !ID_PLANILHA) { throw new Error("Credenciais ou ID da planilha não configurados."); }
        const credenciaisString = Buffer.from(credenciaisBase64, 'base64').toString('utf-8');
        const credenciais = JSON.parse(credenciaisString);
        const auth = new JWT({
            email: credenciais.client_email,
            key: credenciais.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
        });

        const doc = new GoogleSpreadsheet(ID_PLANILHA, auth);
        await doc.loadInfo(); // Carrega informações sobre TODAS as abas

        // ROTA GET: LER AGENDAMENTOS E BLOQUEIOS DA MESMA PLANILHA
        if (event.httpMethod === 'GET') {
            // Lê a aba Agendamentos
            const abaAgendamentos = doc.sheetsByTitle['Agendamentos'];
            let datasOcupadas = [];
            if (abaAgendamentos && abaAgendamentos.rowCount > 1) { // Verifica se aba existe e tem dados
                const linhasAgendamentos = await abaAgendamentos.getRows();
                datasOcupadas = linhasAgendamentos
                    .filter(linha => linha.get('Status') === 'Pendente' || linha.get('Status') === 'Aprovado')
                    .map(linha => linha.get('Data_Visita')) // Assume que Data_Visita já está AAAA-MM-DD na planilha
                    .filter(data => data); // Remove valores vazios/nulos
            } else {
                 console.log("Aba 'Agendamentos' não encontrada ou vazia.");
            }

            // Lê a aba Bloqueios
            const abaBloqueios = doc.sheetsByTitle['Bloqueios'];
            let datasBloqueadas = [];
            if (abaBloqueios && abaBloqueios.rowCount > 1) { // Verifica se aba existe e tem dados
                const linhasBloqueios = await abaBloqueios.getRows();
                datasBloqueadas = linhasBloqueios
                                    .map(linha => converterDataParaISO(linha.get('Data_Bloqueada'))) // Converte DD/MM/AAAA
                                    .filter(data => data !== null); // Remove datas inválidas ou vazias
            } else {
                console.log("Aba 'Bloqueios' não encontrada ou vazia.");
            }
            
            // Combina as duas listas e remove duplicatas
            const todasDatasIndisponiveis = [...new Set([...datasOcupadas, ...datasBloqueadas])];

            return { statusCode: 200, body: JSON.stringify({ status: "sucesso", datas: todasDatasIndisponiveis }) };
        }
        
        // ROTA POST PARA TODAS AS OUTRAS AÇÕES
        if (event.httpMethod === 'POST') {
             const abaAgendamentos = doc.sheetsByTitle['Agendamentos']; // Aba principal para ações POST
             if (!abaAgendamentos) throw new Error("Aba 'Agendamentos' não encontrada na planilha."); // Adiciona verificação
             const linhas = await abaAgendamentos.getRows(); 
             const dados = JSON.parse(event.body);

            if (dados.action === 'login') { 
                if (dados.password !== ADMIN_PASSWORD) { return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Senha incorreta." }) }; }
                const agendamentos = linhas.map(linha => linha.toObject());
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso", dados: agendamentos }) };
            } 
            else if (dados.action === 'aprovar' || dados.action === 'recusar') { 
                if (dados.password !== ADMIN_PASSWORD) return { statusCode: 401, body: JSON.stringify({ status: "erro", message: "Não autorizado." }) };
                const linhaParaAtualizar = linhas.find(row => row.get('ID_Agendamento') === dados.id);
                if (linhaParaAtualizar) {
                    const agendamento = linhaParaAtualizar.toObject();
                    const novoStatus = dados.action === 'aprovar' ? 'Aprovado' : 'Recusado';
                    linhaParaAtualizar.set('Status', novoStatus);
                    linhaParaAtualizar.set('Data_Resposta', new Date().toISOString());
                    await linhaParaAtualizar.save();
                    if (dados.action === 'aprovar') {
                        await enviarEmailDeAprovacao(agendamento);
                        await criarEventoNaAgenda(agendamento, auth, EMAIL_USER);
                    } else {
                        await enviarEmailDeRecusa(agendamento);
                    }
                    await enviarEmailDeConfirmacaoParaAdmin(agendamento, novoStatus.toUpperCase());
                    return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
                } else {
                     throw new Error(`Agendamento com ID ${dados.id} não encontrado para ${dados.action}.`);
                }
             } 
            else { // Novo Agendamento
                const agendamentoPendenteExistente = linhas.find(row => (row.get('Nome_Escola') || '').toLowerCase() === dados.nomeEscola.toLowerCase() && row.get('Status') === 'Pendente');
                if (agendamentoPendenteExistente) { return { statusCode: 400, body: JSON.stringify({ status: "erro", message: "Sua escola já possui um agendamento pendente." }) }; }
                const novaLinha = { 
                    ID_Agendamento: `visita-${new Date().getTime()}`, Data_Solicitacao: new Date().toISOString(), Status: "Pendente",
                    Data_Visita: dados.dataVisita, Periodo: dados.periodo, Nome_Escola: dados.nomeEscola, Cidade_Escola: dados.cidadeEscola,
                    Nome_Responsavel: dados.nomeResponsavel, Telefone_Responsavel: dados.telefoneResponsavel, Email_Responsavel: dados.emailResponsavel,
                    Qtd_Alunos: dados.qtdAlunos, Faixa_Etaria: dados.faixaEtaria, Ano_Letivo: dados.anoLetivo,
                    Objetivo_Visita: dados.objetivoVisita, Pretende_Almocar: dados.pretendeAlmocar, Observacoes: dados.observacoes
                };
                await abaAgendamentos.addRow(novaLinha);
                await enviarEmailParaAdmin(dados);
                await enviarEmailParaVisitante(dados);
                return { statusCode: 200, body: JSON.stringify({ status: "sucesso" }) };
            }
        }
    } catch (error) {
        console.error("Erro na função Netlify:", error.toString());
        return { statusCode: 500, body: JSON.stringify({ status: "erro", message: error.toString() }) };
    }
};

// --- Funções Auxiliares Completas ---
async function criarEventoNaAgenda(agendamento, auth, calendarId) {
    const calendar = google.calendar({ version: 'v3', auth });
    // Validação extra da data
    const dataVisitaInput = agendamento.Data_Visita;
    if (!dataVisitaInput || typeof dataVisitaInput !== 'string') {
        console.error("Data da Visita inválida para criar evento:", agendamento.ID_Agendamento);
        return; 
    }
    const dataVisita = new Date(`${dataVisitaInput}T00:00:00-03:00`);
    if (isNaN(dataVisita.getTime())) { // Verifica se a data é válida
        console.error("Data da Visita inválida após conversão:", agendamento.ID_Agendamento, dataVisitaInput);
        return;
    }

    const horaInicio = agendamento.Periodo === 'Matutino' ? '09:00:00' : '14:00:00';
    const horaFim = agendamento.Periodo === 'Matutino' ? '11:30:00' : '16:30:00';
    // Adiciona try/catch na formatação ISO
    try {
        const dataInicioISO = `${dataVisita.toISOString().split('T')[0]}T${horaInicio}-03:00`;
        const dataFimISO = `${dataVisita.toISOString().split('T')[0]}T${horaFim}-03:00`;
        await calendar.events.insert({
            calendarId: calendarId,
            requestBody: {
                summary: `Visita: ${agendamento.Nome_Escola || 'Escola não informada'}`,
                description: `Responsável: ${agendamento.Nome_Responsavel || '-'}\nContato: ${agendamento.Email_Responsavel || '-'}\nAlunos: ${agendamento.Qtd_Alunos || '-'}\nObjetivo: ${agendamento.Objetivo_Visita || '-'}`,
                start: { dateTime: dataInicioISO, timeZone: 'America/Sao_Paulo' },
                end: { dateTime: dataFimISO, timeZone: 'America/Sao_Paulo' },
            },
        });
        console.log("Evento criado na agenda para:", agendamento.ID_Agendamento);
    } catch (calendarError) {
        console.error("Erro ao criar evento na agenda:", agendamento.ID_Agendamento, calendarError.toString());
        // Não retorna erro fatal, apenas registra o problema
    }
}

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });

async function enviarEmailParaAdmin(dados) {
    await transporter.sendMail({
        from: `"Agenda IFC Concórdia" <${EMAIL_USER}>`, to: "extensao.concordia@ifc.edu.br", subject: `Nova Solicitação de Visita: ${dados.nomeEscola}`,
        html: `<p>Uma nova solicitação de agendamento de visita foi recebida através do site.</p><h3>Detalhes:</h3><ul><li><strong>Escola:</strong> ${dados.nomeEscola}</li><li><strong>Data da Visita:</strong> ${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</li><li><strong>Responsável:</strong> ${dados.nomeResponsavel}</li><li><strong>Contato:</strong> ${dados.emailResponsavel}</li></ul><p>O agendamento foi registrado na planilha e está aguardando aprovação no painel de gestão.</p>`,
    });
}

async function enviarEmailParaVisitante(dados) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: dados.emailResponsavel, subject: "Recebemos sua solicitação de agendamento de visita!",
        html: `<p>Olá, ${dados.nomeResponsavel},</p><p>Recebemos com sucesso sua solicitação de agendamento de visita ao campus do IFC Concórdia para o dia <strong>${new Date(dados.dataVisita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>, no período ${dados.periodo}.</p><p>Sua solicitação está sendo analisada pela nossa equipe. Em breve, você receberá um novo e-mail com a confirmação e mais detalhes sobre a visita.</p><p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Agradecemos o seu interesse!</p><br><p>Atenciosamente,</p><p><strong>Coordenação de Extensão, Ensino, Estágios e Egressos</strong><br>IFC Campus Concórdia</p>`,
    });
}

async function enviarEmailDeAprovacao(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "✅ Agendamento de Visita Confirmado!",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Boas notícias! Sua visita ao IFC Campus Concórdia para o dia <strong>${new Date(agendamento.Data_Visita + 'T12:00:00').toLocaleDateString('pt-BR')}</strong> foi <strong>APROVADA</strong>.</p><p>O evento já foi adicionado à nossa agenda. Estamos ansiosos para recebê-los!</p><p>Qualquer dúvida, você pode entrar em contato conosco através deste e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeRecusa(agendamento) {
    await transporter.sendMail({
        from: `"Coordenação de Extensão IFC Concórdia" <${EMAIL_USER}>`, to: agendamento.Email_Responsavel, subject: "Sobre sua solicitação de visita ao IFC Concórdia",
        html: `<p>Olá, ${agendamento.Nome_Responsavel},</p><p>Agradecemos o seu interesse em visitar o IFC Campus Concórdia. Infelizmente, não poderemos confirmar seu agendamento para a data solicitada.</p><p>Gostaríamos de convidá-lo a tentar o agendamento para uma nova data em nosso site.</p><p>Para qualquer esclarecimento, estamos à disposição por este e-mail ou pelo telefone/WhatsApp <strong>(49) 3341-4819</strong>.</p><p>Atenciosamente,<br>Coordenação de Extensão</p>`,
    });
}

async function enviarEmailDeConfirmacaoParaAdmin(agendamento, statusFinal) {
    await transporter.sendMail({
        from: `"Sistema
