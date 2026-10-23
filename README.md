# Muvies

Um player web em português para organizar e assistir aos vídeos do Google Drive. Interface escura, filtros por gênero acima do player, lista pesquisável, cartões da biblioteca e layout responsivo.

## Desenvolvimento

Requer Node.js 22 ou superior (recomendado: Node.js 24, conforme `.nvmrc`).

```sh
git clone https://github.com/spikeSpy13/muvies.git
cd muvies
npm ci
npm run dev -- --port 5173 --strictPort
```

O servidor escuta em todas as interfaces na porta 5173. A aplicação é um frontend React + TypeScript + Vite; não requer banco de dados ou backend.

```sh
npm run build  # TypeScript e bundle de produção em dist/
npm test       # Testes funcionais de navegador com Playwright
```

Em Linux, os testes usam o Chromium distribuído no pacote npm `@sparticuz/chromium`, sem download adicional do navegador. Em macOS/Windows, execute `npx playwright install chromium` antes dos testes. Os testes cobrem filtros e busca, links inválidos, duplicatas, persistência, edição e remoção, layout móvel, navegação por teclado, importação paginada com API Google simulada e reprodução real da amostra local. A suíte não valida o login real na sua conta Google.

## Usar seus vídeos

1. Clique em **Adicionar vídeo**.
2. Cole o link de um arquivo de vídeo do Drive (`https://drive.google.com/file/d/ID/view` ou `https://drive.google.com/open?id=ID`). Links de pastas não são aceitos.
3. Escolha um título e um gênero. É possível criar gêneros digitando seus nomes.
4. Selecione o vídeo e aperte play. O arquivo é aberto no player incorporado do Google Drive.

Vídeos compartilhados mantêm suas permissões originais. Para vídeos privados, o navegador precisa estar conectado a uma conta Google com acesso ao arquivo. Bloqueio de cookies de terceiros, restrições de incorporação, limites de reprodução do Drive e arquivos ainda em processamento podem impedir a reprodução. O link **abra no Drive** permite usar o player diretamente no Google. A autorização para listar vídeos e a sessão Google do player incorporado são independentes.

A biblioteca e o Client ID público ficam no `localStorage` deste navegador. Não há sincronização automática entre aparelhos. Remover um cartão não exclui o arquivo no Drive. As duas amostras locais são identificadas como demonstrações e não pertencem ao seu Drive.

## Conectar a conta Google

Adicionar links funciona sem configurar uma integração OAuth. Para importar automaticamente a lista dos seus vídeos privados ou compartilhados:

1. Crie um projeto no Google Cloud e ative a **Google Drive API**.
2. Configure a tela de consentimento OAuth. Se o aplicativo estiver em modo de teste, cadastre sua conta como usuário de teste.
3. Crie uma credencial OAuth do tipo **Aplicativo da Web**. Adicione a origem exata usada para abrir o Muvies às **Origens JavaScript autorizadas**. A janela de conexão mostra essa origem. Em produção, use HTTPS. Em desenvolvimento, o Google permite uma origem localhost.
4. Cadastre o escopo `https://www.googleapis.com/auth/drive.metadata.readonly` na configuração de acesso a dados.
5. No Muvies, clique em **Conectar Drive**, informe o **Client ID** público e continue com o Google. Não forneça Client Secret, senha ou token.

O login usa Google Identity Services e o fluxo de token para aplicativos de navegador. O token fica apenas em memória durante a importação; não é salvo. O aplicativo solicita somente acesso de leitura aos metadados, lista os arquivos de vídeo com paginação e preserva os títulos e gêneros já editados. Para atualizar a lista, use **Sincronizar Drive** e autorize a sessão novamente. Arquivos não são alterados ou excluídos. A importação não altera permissões de compartilhamento.

A integração real depende do seu projeto OAuth e da autorização da sua conta. Ela não foi validada com uma conta real neste ambiente. Apps externos em produção podem exigir verificação do Google conforme o escopo e o público configurados.

## Publicação

Execute `npm run build` e publique a pasta `dist/` em um serviço de hospedagem estática com HTTPS. Não envie `node_modules/`. Adicione a origem final à credencial OAuth antes de conectar a conta. Fontes, imagens e vídeos de demonstração são locais. A conexão com o Google precisa de acesso a `accounts.google.com`, `www.googleapis.com` e `www.gstatic.com`; o player usa `drive.google.com` e pode carregar recursos de `*.googleusercontent.com` e `*.googlevideo.com`.

## Créditos

- **Big Buck Bunny**: © Blender Foundation, [bigbuckbunny.org](https://www.bigbuckbunny.org/), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Amostra de aproximadamente 60 segundos e imagem distribuídas pelo [repositório de mídia do MediaElement](https://github.com/mediaelement/mediaelement-files). A imagem de capa foi extraída da amostra local; apenas redimensionamento e corte visual via CSS.
- **Flower**: amostra de aproximadamente 5 segundos do [MDN Interactive Examples](https://github.com/mdn/interactive-examples/tree/main/live-examples/media/cc0-videos), domínio público, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Capa extraída do vídeo.
- **DM Sans** e **Manrope**: fontes distribuídas via Fontsource sob a SIL Open Font License.
- Ícones: Lucide, licença ISC.

Não há vínculo oficial entre Muvies, Google ou Blender Foundation.
