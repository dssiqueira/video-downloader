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

- **X / Twitter** — detecta vídeos enquanto você navega, injeta botão de download direto na timeline e permite buscar por URL do post
- **Instagram** — captura vídeos de Reels, Posts e Stories enquanto são reproduzidos
- Exibe **múltiplas qualidades** disponíveis (1080p, 720p, 480p, 360p...)
- Mostra **tamanho do arquivo** antes de baixar
- Interface limpa que reconhece automaticamente em qual plataforma você está
- Zero dependências externas — nenhum dado sai do seu navegador

---

## 🖥️ Screenshots

| Popup no X/Twitter | Popup no Instagram |
|---|---|
| Badge do X, busca por URL, qualidades disponíveis | Badge do Instagram, vídeos detectados na página |

---

## 🚀 Instalação

> A extensão ainda não está publicada na Chrome Web Store. Instale em modo desenvolvedor:

**1.** Clone ou baixe este repositório

```bash
git clone https://github.com/seu-usuario/video-downloader.git
```

**2.** Abra o Chrome e acesse `chrome://extensions`

**3.** Ative o **Modo do desenvolvedor** (toggle no canto superior direito)

**4.** Clique em **"Carregar sem compactação"** e selecione a pasta do projeto

**5.** O ícone da extensão aparecerá na barra do Chrome — pronto ✓

---

## 📖 Como usar

### X / Twitter

Duas formas de baixar:

**Via botão na timeline**
1. Navegue pelo X.com normalmente
2. Um botão ↓ aparece na barra de ações de cada tweet com vídeo
3. Clique para iniciar o download diretamente

**Via popup (todas as qualidades)**
1. Clique no ícone da extensão
2. Cole a URL do post com vídeo
3. Clique em **Buscar**
4. Escolha a qualidade e clique em **Baixar**

### Instagram

1. Navegue até o Reel, Post ou Story com vídeo
2. **Reproduza o vídeo** (necessário para o browser carregar a URL)
3. Clique no ícone da extensão
4. O vídeo aparecerá automaticamente em *Vídeos detectados nesta página*
5. Clique em **Baixar**

> **Dica:** Se o vídeo não aparecer, clique no botão ↺ (atualizar) no popup após reproduzir.

---

## 🏗️ Arquitetura

```
video-downloader/
│
├── manifest.json                  # Manifest V3 — permissões e scripts
│
├── background/
│   └── background.js              # Service Worker
│                                  # · Cache de vídeos por aba
│                                  # · Fetch da API do X (syndication + fxtwitter)
│                                  # · Gerencia chrome.downloads
│
├── content/
│   ├── content.css                # Estilos injetados (botão ↓, toast)
│   └── platforms/
│       ├── twitter.js             # Intercepta XHR/Fetch do X, injeta botão na timeline
│       └── instagram.js           # Lê window.__additionalData, intercepta API GraphQL,
│                                  # observa <video> src via MutationObserver + play event
│
├── popup/
│   ├── popup.html / .css / .js    # Interface principal da extensão
│   └── about.html / .css          # Página "Sobre" com plataformas suportadas
│
└── icons/
    ├── icon16/48/128.png          # Ícones da extensão
    └── apps/
        ├── twitter.png            # Logo X/Twitter
        └── social.png             # Logo Instagram
```

---

## ⚙️ Como funciona por dentro

### X / Twitter

O content script sobrescreve `window.fetch` e `XMLHttpRequest.prototype.open` para interceptar todas as requisições de rede feitas pela página. Quando detecta uma URL do CDN `video.twimg.com` ou uma resposta da API `TweetDetail`, extrai as variantes de vídeo com bitrate e resolução.

Para busca por URL, o background service worker chama a **API de sindicalização pública** do Twitter (`cdn.syndication.twimg.com`) — sem autenticação — e faz fallback para a API `fxtwitter.com` se necessário.

### Instagram

Usa três camadas de detecção em paralelo:

| Camada | O que faz |
|---|---|
| `window.__additionalData` | Lê dados SSR injetados pelo Instagram no HTML da página, incluindo `video_url` e `video_versions[]` |
| Interceptação de API | Monitora respostas de `/graphql/query` e `/api/v1/` que contêm `video_url` no JSON |
| MutationObserver + `play` event | Captura `currentSrc` do `<video>` quando o usuário aperta play — fallback mais confiável |

---

## 🔒 Permissões utilizadas

| Permissão | Motivo |
|---|---|
| `activeTab` | Ler a URL da aba ativa para identificar a plataforma |
| `scripting` | Injetar content scripts nas páginas |
| `downloads` | Iniciar downloads via `chrome.downloads.download()` |
| `storage` | Reservado para configurações futuras |
| `tabs` | Consultar informações da aba atual no popup |

Nenhuma permissão de rede desnecessária. Os `host_permissions` cobrem apenas os domínios das plataformas suportadas e seus CDNs.

---

## ⚠️ Limitações

- **Contas privadas** — vídeos de perfis privados não podem ser acessados
- **Instagram Stories expirados** — URLs de mídia têm validade curta
- **YouTube** — não suportado; a plataforma usa proteção DRM/DASH que não pode ser contornada sem APIs externas
- A detecção no Instagram requer que o vídeo seja reproduzido na sessão atual

---

## 🛠️ Tecnologias

- **Manifest V3** — padrão atual das extensões Chrome
- **Chrome Extensions API** — `downloads`, `tabs`, `scripting`, `storage`
- **Vanilla JS** — sem frameworks, sem bundler, sem dependências
- **CSS puro** — tema escuro inspirado no X.com

---

## 📄 Licença

Uso pessoal. Baixe apenas conteúdo que você tem permissão para usar e respeite os termos de serviço de cada plataforma.
