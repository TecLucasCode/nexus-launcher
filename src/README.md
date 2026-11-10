# NEXUS Launcher — biblioteca de jogos com conta, saves, XP, chat e convites

Launcher web estilo Steam, em português, feita para centralizar **seus jogos do GitHub**:

- **Contas** (criar/entrar/convidado). Login persiste entre aparelhos; progresso, XP e jogos ficam na nuvem (server-plugin) + cópia local.
- **Biblioteca**: banner de destaque, continuar jogando 🕘, favoritos ⭐, busca, filtro por categoria e ordenação (A–Z, XP, favoritos) + **Stick Arena** (do Lucas, via GitHub Pages) e 2 demos embutidas.
- **NEXUS ID 🪪**: cada conta tem um ID único (ex: `NX-AB12CD`) — convites aceitam @usuário ou NEXUS ID.
- **Contas vinculadas 🔗**: vincule seu nick de cada jogo; ele é injetado automaticamente ao abrir o jogo (protocolo `getIdentity`/`identity` via postMessage).
- **Sessão de jogo 🎫**: token válido por 60 min gerado ao jogar, com contagem regressiva e botão renovar.
- **Ranking 🏆**: top 20 por XP no servidor + sua posição no perfil.
- **Recompensa diária 🎁**: +25 XP por dia no perfil.
- **Sons**: bipes de level-up, convite e favorito (WebAudio, sem arquivos).
- **GitHub**: aba “🐙 GitHub” lista os repos de um usuário e importa com 1 clique. Para jogar, ative **Pages** no repo (`Settings → Pages → Deploy from a branch`) e use a URL `https://SEUUSER.github.io/SEUREPO`.
- **Saves**: 3 slots por jogo na nuvem ☁️ + local. Jogos integrados salvam via `postMessage` (ver `src/games/neon-clicker.html`); externos usam o botão 💾.
- **XP/níveis**: jogar (+2/min), salvar (+3), adicionar jogo (+10), chat (+1), marcos via API do jogo.
- **Chat**: global + sala por jogo, tempo real (pub/sub).
- **Convites**: convide pelo nome de usuário → o amigo recebe na hora e entra no mesmo jogo.
- **Integrar seu jogo** (qualquer engine que rode no browser):
```js
parent.postMessage({nexus:"save", slot:1, data: JSON.stringify({fase:3})}, "*"); // salva na nuvem
parent.postMessage({nexus:"xp", amount:5, reason:"passou de fase"}, "*");        // dá XP
window.addEventListener("message", e=>{ if(e.data?.nexus==="load") carregar(e.data.data); });
```

## Arquivos
- `index.html` — shell + servidor autoritativo (`<script type="text/x-server-plugin">`: contas com hash SHA-256, sessões, XP, saves, catálogo, chat, convites, presença).
- `src/app.js` — toda a UI da launcher. `src/net.js` — socket/RPC com fallback local.
- `src/games/` — demos integradas (exemplos de save/XP via postMessage).
- `main.pjs` — `$meta` + imports (`server-plugin`, `kv-plugin`).

## Publicar no GitHub
1. Salve o generator, baixe `index.html` + `src/`.
2. Suba num repo com **Pages** ativado. A launcher detecta a falta do servidor e roda em **modo local** (conta de convidado + localStorage).
3. O multiplayer em nuvem (saves/XP/chat/convites entre aparelhos) funciona aqui no Perchance. Para nuvem própria no GitHub, plugue Firebase/Supabase.

## Limites do servidor
Soft-cap ~4 MB de estado; 2000 usuários, 400 jogos, 80 msgs/sala, 20 KB por save, XP com limite diário e rate-limit por conexão.
