<div align="center">

<img src="icons/icon128.png" width="96" alt="Video Downloader icon" />

# Video Downloader

**Extensão Chrome para baixar vídeos do X (Twitter) e Instagram — sem serviços externos, tudo no próprio navegador.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen?style=flat-square)

</div>

---

## ✨ O que faz

- **X / Twitter**: botão ↓ na barra de ações de cada tweet com vídeo (inclusive quote tweets e retweets) e lista no popup
- **Instagram**: Reels, Posts (inclusive carrossel) e Stories, assim que a página carrega o post
- Mostra **todas as qualidades** (1080p, 720p, 480p…) com resolução, bitrate e **tamanho do arquivo**
- Contador no ícone da extensão com quantos vídeos a aba já carregou
- **Nenhum serviço externo**: a extensão não faz requisições a APIs de terceiros e nenhum dado sai do seu navegador

---

## 🚀 Instalação

> A extensão ainda não está publicada na Chrome Web Store. Instale em modo desenvolvedor (Chrome 111+):

1. Clone ou baixe este repositório

   ```bash
   git clone https://github.com/dssiqueira/video-downloader.git
   ```

2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto
4. Recarregue as abas do X e do Instagram que já estavam abertas

---

## 📖 Como usar

### X / Twitter

- **No tweet**: clique no botão ↓ da barra de ações. Ele baixa a melhor qualidade.
- **No popup**: abra um tweet (ou role a timeline) e clique no ícone da extensão. O vídeo do tweet aberto aparece em *Este post*, com todas as qualidades; os outros vídeos que a página carregou aparecem abaixo.

### Instagram

Abra o post, reel ou story e clique no ícone da extensão. O vídeo aparece em *Este post*; escolha a qualidade e clique em **Baixar**.

> Se nada aparecer, recarregue a página: a extensão só enxerga o que a página carregou depois que ela foi instalada.

---

## ⚙️ Como funciona

O X e o Instagram carregam os posts pelas próprias APIs (GraphQL e REST), e essas respostas JSON já trazem os links MP4 de todas as qualidades. A extensão lê uma cópia dessas respostas, sem alterar nada nem fazer requisições próprias.

```
página (x.com / instagram.com)
  └─ content/hook.js        world MAIN, document_start
       envolve fetch() e XMLHttpRequest; copia as respostas da API que mencionam vídeo
       │ window.postMessage
       ▼
  └─ content/bridge.js      mundo isolado da extensão
       lib/extract.js acha os vídeos no JSON (e no JSON embutido no HTML do Instagram)
       │ chrome.runtime.sendMessage
       ▼
background/background.js    service worker
       lista por aba (memória + chrome.storage.session), contador no ícone,
       tamanho dos arquivos (HEAD) e downloads
       ▲
       ├─ popup/               lista os vídeos da aba, post aberto primeiro
       └─ content/x-buttons.js botão ↓ nos tweets, busca pelo ID do tweet
```

Detalhes que importam:

- O `hook.js` precisa rodar no mundo da página (`"world": "MAIN"`) e em `document_start`. Um content script comum roda num mundo isolado e não enxerga o `fetch` da página, que era o motivo de a versão 2 quase nunca achar vídeos no Instagram.
- No X, cada vídeo é associado ao tweet dono dele e também aos tweets que o mostram (quote tweet, retweet), então o botão funciona em todos.
- Só são aceitos links `https` dos CDNs das plataformas (`video.twimg.com`, `*.cdninstagram.com`, `*.fbcdn.net`), conferidos pelo hostname em três lugares: na extração, no service worker e antes de cada download.
- A lista de cada aba recomeça quando a página é recarregada (os links do Instagram expiram).

```
video-downloader/
├── manifest.json
├── lib/extract.js          # extração de vídeos (funções puras, testadas)
├── content/
│   ├── hook.js             # mundo da página: copia respostas da API
│   ├── bridge.js           # mundo isolado: extrai e envia ao service worker
│   ├── x-buttons.js        # botão ↓ nos tweets
│   └── content.css
├── background/background.js
├── popup/                  # popup e página "Sobre"
├── icons/
└── tests/
    ├── extract.test.js     # node --test
    ├── fixtures/           # respostas de API de exemplo (X e Instagram)
    └── e2e/run_e2e.py      # Chrome real + páginas simuladas do X e do Instagram
```

---

## 🧪 Testes

```bash
node --test tests/*.test.js                  # extração (sem dependências)

pip install playwright && python -m playwright install chromium
python tests/e2e/run_e2e.py                  # extensão carregada no Chromium
```

O teste de ponta a ponta abre páginas falsas de `x.com` e `instagram.com` (respondidas localmente a partir de `tests/fixtures`), e confere a captura via `fetch` e XHR, o botão nos tweets, o popup, os downloads e que a página continua funcionando com o hook. Ele roda no CI a cada pull request.

As fixtures seguem o formato das respostas reais, mas X e Instagram mudam suas APIs sem aviso. Se um vídeo parar de aparecer, salve a resposta da API (DevTools → Network) em `tests/fixtures`, escreva um teste e ajuste `lib/extract.js`.

---

## 🔒 Permissões

| Permissão | Motivo |
|---|---|
| `downloads` | Baixar o arquivo escolhido |
| `storage` | Guardar a lista de vídeos de cada aba enquanto ela está aberta (`storage.session`, apagada ao fechar) |
| `x.com`, `twitter.com`, `www.instagram.com` | Rodar os scripts nessas páginas e saber qual post está aberto |
| `video.twimg.com`, `*.cdninstagram.com`, `*.fbcdn.net` | Consultar o tamanho dos arquivos e baixá-los |

---

## ⚠️ Limitações

- Só aparecem vídeos que a própria página carregou: sem acesso ao post (conta privada, restrição de idade), a extensão também não tem.
- Links do Instagram expiram depois de algumas horas; recarregue a página se um download falhar.
- YouTube, TikTok e outras redes não são suportados.

---

## 📄 Licença

[MIT](LICENSE). Baixe apenas conteúdo que você tem permissão para usar e respeite os termos de serviço de cada plataforma.
