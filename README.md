# Muvies

Um catálogo de cinema em português com fundo de papel, tipografia clássica e uma grade pesquisável de vídeos. A página inicial mostra todos os filmes cadastrados, sem banner ou filme em destaque. O menu no topo permite combinar gênero, ano e país com a busca. Os filmes são adicionados por links do Google Drive. Ao clicar em uma capa, título ou botão de assistir, o aplicativo abre a sala de projeção e inicia o filme.

Não é necessário conectar uma conta Google, configurar Client ID ou importar o Drive. Use links públicos que permitam baixar o arquivo original. O catálogo começa vazio, sem filmes de demonstração.

## Rodar localmente

Requer Node.js 22 ou superior (recomendado: Node.js 24, conforme `.nvmrc`).

```sh
git clone https://github.com/spikeSpy13/muvies.git
cd muvies
npm ci
npm run dev -- --port 5173 --strictPort
```

O servidor escuta na porta 5173, incluindo as interfaces da rede local (`0.0.0.0`). Mantenha o terminal aberto durante o uso. A aplicação usa React, TypeScript e Vite com armazenamento em arquivo e transmissão de vídeo integrados: não precisa instalar banco de dados ou outro serviço.

Para atualizar uma instalação existente, pare o servidor, execute `git pull --ff-only` e `npm ci`, e inicie novamente. Os dados em `.muvies` não fazem parte do Git e permanecem salvos.

## Usar o catálogo

1. Clique em **Adicionar vídeo** e cole um link de arquivo do Drive (`https://drive.google.com/file/d/ID/view` ou `https://drive.google.com/open?id=ID`). Links de pastas não são aceitos.
2. Informe título e gênero e, se desejar, **Ano** e **País**. Envie o **Pôster do filme** (vertical) para os cards. Em **Detalhes do filme (opcional)**, adicione direção e sinopse. Você pode criar gêneros digitando seus nomes.
3. Busque por título, direção, gênero, ano ou país. Os gêneros do menu e as opções de ano e país acompanham os vídeos cadastrados; combine os filtros para refinar a lista e use **Todos** ou **Limpar filtros** para voltar ao acervo completo. O marcador guarda o filme na **Minha lista**; o lápis permite editar os dados ou remover o link.
4. Clique no filme para abrir o player e iniciar a reprodução. **Voltar ao catálogo** retorna à página inicial. Os botões voltar/avançar do navegador também funcionam.

A URL `?filme=ID` identifica o filme no player e pode ser reaberta ou compartilhada entre aparelhos com acesso ao mesmo servidor. Ao abrir diretamente uma URL ou recarregar a página, o navegador pode exigir outro clique para permitir a reprodução com áudio; o aplicativo oferece tentar novamente.

O catálogo mostra apenas os filmes adicionados por você. Os cards usam o pôster enviado; sem pôster, usam as vinhetas de cinema do modelo editorial. Informações como direção, ano, país e sinopse só aparecem quando preenchidas. Filmes antigos sem país continuam visíveis na lista completa; edite-os para incluir essa informação e encontrá-los no filtro de país.

### Pôster e imagem de destaque

Para os cards, a proporção sugerida do pôster é **2:3**. A imagem horizontal de destaque continua armazenada e pode ser editada, mas não aparece na página inicial simplificada. Os dois campos têm prévias independentes. São aceitos JPG, PNG e WebP de até **10 MB** e **40 megapixels** cada. É possível trocar ou remover uma imagem sem alterar a outra.

As imagens só são enviadas quando você salva o filme. O servidor valida o conteúdo, corrige a orientação, remove metadados e gera WebP com até 2400 pixels por dimensão, preservando a proporção. Os arquivos ficam em **`.muvies/images/`**, vinculados pelo catálogo, disponíveis após reiniciar e para os demais aparelhos da rede. A seleção e a prévia não alteram o catálogo antes de salvar. Imagens já enviadas podem ser reaproveitadas em uma nova tentativa de gravação.

## Reprodução por link público

O modo **Reprodução direta** transmite o original ao player HTML5 pelo servidor local. O aplicativo trata a confirmação normal de download público de arquivos grandes. Não depende do processamento da prévia do Google, mas o arquivo precisa estar disponível para download sem login.

No Drive, confira se o arquivo está compartilhado como **Qualquer pessoa com o link** e permite download. Um link acessível somente com sua conta Google não se torna público ao ser adicionado ao catálogo. Cotas, bloqueios e restrições do proprietário continuam valendo; a aplicação informa o problema sem pedir conexão Google.

O servidor transmite em fluxo e preserva `Range`/`206`, permitindo avançar ou voltar sem baixar o filme inteiro para a memória ou gravá-lo em disco antes de começar. Trocar de filme ou voltar ao catálogo encerra a reprodução. Ele segue apenas confirmações normais de download do mesmo arquivo em endereços reconhecidos do Google; não contorna permissões ou bloqueios.

O original precisa ter codecs compatíveis com o navegador. MP4 com H.264 e áudio AAC oferece ampla compatibilidade. Alguns MKV, AVI, HEVC/H.265 ou formatos de áudio precisam de conversão externa ou de um player local como VLC. O Muvies não converte vídeos.

O modo **Player do Drive** permanece disponível como alternativa e depende da prévia processada pelo Google, das permissões e dos cookies do navegador. **Abrir no Drive** abre o arquivo no Google. Chaves `resourcekey` são preservadas nos links.

Rodar localmente não significa funcionar offline: os vídeos que estão no Drive precisam de internet para chegar ao servidor.

## Legendas SRT

Na sala de projeção, clique em **Carregar legenda (.srt)** e escolha um arquivo de até 2 MB. A legenda fica vinculada ao vídeo e salva em `.muvies/subtitles/`, disponível também nos outros aparelhos. É possível trocar, mostrar/ocultar ou remover. Mostrar/ocultar altera somente sua reprodução; trocar/remover atualiza o arquivo compartilhado.

As legendas externas funcionam na **Reprodução direta**. Ao carregar SRT no modo **Player do Drive**, o aplicativo muda para a reprodução direta, pois o iframe do Google não aceita uma faixa externa enviada pelo Muvies.

Para sincronizar a legenda com o áudio, abra **Ajustar legenda** no player. Use **Adiantar 0,5 s**, **Atrasar 0,5 s** ou digite o deslocamento em segundos (até 600 segundos em cada sentido). Valores negativos mostram o texto antes; positivos, depois. **Zerar ajuste** restaura os horários originais, sem reiniciar o vídeo. O ajuste fica salvo neste navegador para cada vídeo e versão da legenda; não altera o SRT compartilhado. Funciona na reprodução direta com as legendas ativadas.

O servidor valida os tempos e converte SRT para WebVTT, preservando acentos e quebras de linha. São aceitos UTF-8, Windows-1252 e UTF-16 com BOM. Marcações de formatação são exibidas como texto. Trocar uma legenda não reinicia o vídeo e não altera seus codecs.

## Arquivos salvos e rede local

Links, títulos, gêneros, detalhes editoriais e favoritos ficam em **`.muvies/library.json`**, no computador que executa o servidor. A gravação é confirmada antes de a interface informar sucesso. Fechar o navegador, trocar de aparelho ou reiniciar o servidor não apaga os dados.

Na primeira abertura, se o arquivo ainda não existir, o aplicativo importa os links da versão antiga guardados no navegador. Depois, o arquivo passa a ser a fonte compartilhada; uma biblioteca intencionalmente vazia permanece vazia. A seleção recente pode continuar como preferência local do navegador.

Para usar em outros aparelhos da mesma rede, abra o endereço **Network** mostrado no terminal, com o IP privado do computador servidor e a porta 5173. Não use localhost no outro aparelho, pois ele aponta para o próprio aparelho. Todos acessam o mesmo catálogo, Minha lista e legendas, com atualizações a cada três segundos e ao retornar para a janela.

As alterações usam revisões para evitar que duas gravações simultâneas apaguem silenciosamente os dados uma da outra. Se houver conflito, a interface recebe a versão atual e permite conferir e tentar novamente. Remover um link não exclui o vídeo do Drive.

Para backup ou transferência, copie a pasta **`.muvies`** com o aplicativo parado. A variável opcional `MUVIES_LIBRARY_DIR` define outro diretório de dados. As APIs aceitam endereços de loopback ou rede privada e requisições da própria origem. Este servidor foi feito para uso pessoal na rede local.

## Build e testes

```sh
npm run build
npm test
```

Os testes cobrem navegação catálogo/player, reprodução HTML5 com arquivo real de teste, busca, gêneros, Minha lista, envio e edição de pôster e destaque, persistência e conflitos, migração de versões anteriores, layout móvel, teclado, legendas e sincronização entre navegadores. Os testes de servidor verificam arquivos em disco, validação e processamento das imagens, streaming com Range, confirmações públicas, erros e restrições de origem. O Google é simulado; a suíte não valida todos os links ou as políticas atuais do provedor.

Em Linux, os testes usam o Chromium do pacote `@sparticuz/chromium`. Em macOS/Windows, execute `npx playwright install chromium` antes dos testes.

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

O preview inclui as rotas de armazenamento, legendas e transmissão. Publicar somente `dist/` em hospedagem estática não inclui essas APIs. Esta versão precisa de Node.js e Vite como servidor local.

As fontes, ilustrações e ícones são locais, sem CDN ou login Google no catálogo. Downloads públicos podem acessar `drive.google.com`, `drive.usercontent.google.com` e `*.googleusercontent.com`. O player alternativo pode usar também `*.googlevideo.com` e os serviços do Google necessários à incorporação.

Em ambientes Node.js 24 com `HTTP_PROXY`/`HTTPS_PROXY`, use `NODE_USE_ENV_PROXY=1 npm run dev`, preservando a verificação TLS. Em instalações sem proxy, use o comando normal.

## Créditos

- Diagramação editorial e ilustrações SVG adaptadas do HTML fornecido pelo usuário.
- Cormorant Garamond, Playfair Display, EB Garamond, Josefin Sans, DM Sans e Manrope: distribuídas via Fontsource sob a SIL Open Font License.
- Ícones: Lucide, licença ISC.
- Fixture **Flower**, de aproximadamente 5 segundos em `tests/fixtures/native-video.mp4`: [MDN Interactive Examples](https://github.com/mdn/interactive-examples/tree/main/live-examples/media/cc0-videos), domínio público, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Usada somente em testes, sem inclusão no catálogo.

Não há vínculo oficial entre Muvies e Google.
