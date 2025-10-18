exports.handler = async (event, context) => {
    try {
        // Pega as credenciais da variável de ambiente do Netlify
        const credenciaisString = process.env.GOOGLE_CREDENTIALS;

        // Verifica se a variável foi encontrada
        if (credenciaisString && credenciaisString.length > 10) {
            // Se encontrou, registra o sucesso no log!
            console.log("SUCESSO: Variável de ambiente GOOGLE_CREDENTIALS foi encontrada.");

            return {
                statusCode: 200,
                body: JSON.stringify({ status: "ok", message: "Variável de ambiente encontrada!" })
            };

        } else {
            // Se não encontrou, registra o erro no log!
            console.error("ERRO: Variável de ambiente GOOGLE_CREDENTIALS está vazia ou não foi encontrada.");

            return {
                statusCode: 500,
                body: JSON.stringify({ status: "erro", message: "Variável de ambiente não configurada." })
            };
        }

    } catch (error) {
        console.error("ERRO CATASTRÓFICO:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: "erro", message: error.message })
        };
    }
};
