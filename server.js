const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browserInstance = null;

async function initBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080
            }
        });
    }
    return browserInstance;
}

async function buscarNoticiasDoGoogle(consulta, tamanhoPagina = 100) {
    const termoConsulta = encodeURIComponent(consulta);
    const urlGoogleNoticias = `https://www.google.com/search?q=${termoConsulta}&tbm=nws&hl=pt-BR&num=${tamanhoPagina}`;
    
    const browser = await initBrowser();
    const page = await browser.newPage();
    
    try {
        console.log(`Iniciando busca de notícias para consulta: ${consulta}`);
        
        // Configuração aprimorada da página
        await page.setDefaultTimeout(60000);
        await page.setDefaultNavigationTimeout(60000);
        
        // Configurar cabeçalhos comuns
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Pragma': 'no-cache',
            'Upgrade-Insecure-Requests': '1',
            'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'DNT': '1'
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Injetar scripts para mascarar automação
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            window.chrome = { runtime: {} };
        });

        console.log('Navegando para a busca do Google Notícias...');
        await page.goto(urlGoogleNoticias, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Adicionar atraso maior para carregamento da página
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Debug: Registrar título e URL da página
        const tituloPagina = await page.title();
        const urlAtual = page.url();
        console.log('Título atual da página:', tituloPagina);
        console.log('URL atual:', urlAtual);

        // Seletores atualizados baseados na estrutura do Google Notícias
        const seletoresPossiveis = [
            'div[class*="g"]',  // Itens padrão de busca do Google
            'div[role="article"]', // Artigos de notícias
            'div.xuvV6b', // Outro possível container de notícias
            'div.SoaBEf', // Container de cartão de notícias
            'div.WlydOe' // Container alternativo de notícias
        ];

        console.log('Verificando containers de notícias com seletores:', seletoresPossiveis);

        // Debug: Verificar presença de cada seletor
        for (const seletor of seletoresPossiveis) {
            const contagem = await page.$$eval(seletor, elements => elements.length);
            console.log(`Encontrados ${contagem} elementos com seletor: ${seletor}`);
        }

        // Aguardar qualquer seletor estar presente
        try {
            await page.waitForSelector(seletoresPossiveis.join(','), { timeout: 15000 });
        } catch (err) {
            console.log('Tirando screenshot de depuração...');
            await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
            
            // Obter conteúdo da página para depuração
            const conteudo = await page.content();
            console.log('Tamanho do HTML da página:', conteudo.length);
            // Salvar conteúdo HTML para depuração
            require('fs').writeFileSync('debug-page.html', conteudo);
            
            throw new Error('Nenhum container de notícias encontrado - verifique debug-screenshot.png e debug-page.html');
        }

        console.log('Extraindo artigos...');
        const artigos = await page.evaluate((seletores) => {
            const resultados = [];
            
            // Tentar todos os seletores possíveis para itens de notícias
            seletores.forEach(seletor => {
                const itens = document.querySelectorAll(seletor);
                console.log(`Processando ${itens.length} itens para seletor ${seletor}`);
                
                itens.forEach((item, index) => {
                    try {
                        // Seletores atualizados para diferentes elementos
                        const elementoTitulo = item.querySelector('h3, h4, [role="heading"], .mCBkyc, .n0jPhd, a > div');
                        const elementoLink = item.querySelector('a[href*="http"]');
                        const elementoDescricao = item.querySelector('.VwiC3b, .GI74Re, .s3v9rd, .Y3v8qd');
                        const elementoFonte = item.querySelector('.UPmit, .NUnG9d, .CEMjEf');
                        const elementoTempo = item.querySelector('.WG9SHc, .ZE0LJd, time, .LfVVr');

                        if (elementoTitulo && elementoLink) {
                            const dadosArtigo = {
                                titulo: elementoTitulo.innerText.trim(),
                                descricao: elementoDescricao ? elementoDescricao.innerText.trim() : '',
                                url: elementoLink.href,
                                fonte: {
                                    nome: elementoFonte ? elementoFonte.innerText.trim() : 'Fonte Desconhecida',
                                    id: null
                                },
                                dataPublicacao: elementoTempo ? elementoTempo.innerText.trim() : null,
                                conteudo: ''
                            };

                            // Adicionar apenas se não tivermos esta URL
                            if (!resultados.some(r => r.url === dadosArtigo.url)) {
                                resultados.push(dadosArtigo);
                            }
                        }
                    } catch (err) {
                        console.error(`Erro ao processar item ${index} com seletor ${seletor}:`, err);
                    }
                });
            });

            return resultados;
        }, seletoresPossiveis);

        console.log(`Encontrados ${artigos.length} artigos antes da filtragem`);
        
        if (artigos.length === 0) {
            console.log('Nenhum artigo encontrado após processamento. Tirando screenshot...');
            await page.screenshot({ path: 'no-articles-screenshot.png', fullPage: true });
        }

        const artigosLimitados = artigos.slice(0, tamanhoPagina);
        console.log(`Retornando ${artigosLimitados.length} artigos após limitar ao tamanho da página`);

        await page.close();
        return artigosLimitados;

    } catch (erro) {
        console.error('Erro em buscarNoticiasDoGoogle:', erro);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        await page.close();
        throw erro;
    }
}

app.get('/api/noticias', async (req, res) => {
    try {
        const { q: consulta, tamanhoPagina = 10, textoCompleto = false } = req.query;
        
        if (!consulta) {
            return res.status(400).json({
                status: 'erro',
                mensagem: 'Parâmetro de consulta "q" é obrigatório'
            });
        }

        console.log(`Processando requisição para consulta: ${consulta}, tamanhoPagina: ${tamanhoPagina}`);
        const artigos = await buscarNoticiasDoGoogle(consulta, parseInt(tamanhoPagina));

        res.json({
            status: 'ok',
            totalResultados: artigos.length,
            artigos: artigos
        });

    } catch (erro) {
        console.error('Erro na API:', erro);
        res.status(500).json({
            status: 'erro',
            mensagem: 'Falha ao buscar artigos de notícias',
            detalhes: erro.message
        });
    }
});

process.on('SIGTERM', async () => {
    if (browserInstance) {
        await browserInstance.close();
    }
    process.exit(0);
});

app.listen(port, () => {
    console.log(`Servidor da API de Notícias rodando na porta ${port}`);
});
