# Muvies

Um player web em português para organizar e assistir aos vídeos do Google Drive. Tela simples com o player, filtros por gênero e lista pesquisável acima dele. Os links ficam salvos no próprio aplicativo e são compartilhados pelos aparelhos da rede local. A biblioteca começa vazia, sem vídeos de demonstração.

## Desenvolvimento

Requer Node.js 22 ou superior (recomendado: Node.js 24, conforme `.nvmrc`).

```sh
git clone https://github.com/spikeSpy13/muvies.git
cd muvies
npm ci
npm run dev -- --port 5173 --strictPort
```

O servidor escuta na porta 5173, incluindo as interfaces da rede local (`0.0.0.0`). A aplicação usa React + TypeScript + Vite, com um pequeno servidor local de transmissão integrado ao Vite. Não precisa instalar outro serviço ou banco de dados. Mantenha o terminal aberto durante a reprodução. A interface pode ser aberta usando `localhost` ou `127.0.0.1`; cadastre no Google a origem exata que você usar.

```sh
npm run build  # TypeScript e bundle de produção em dist/
npm test       # Testes do servidor local e testes de navegador com Playwright
```

Em Linux, os testes usam o Chromium distribuído no pacote npm `@sparticuz/chromium`, sem download adicional do navegador. Em macOS/Windows, execute `npx playwright install chromium` antes dos testes. Os testes cobrem filtros e busca, links inválidos, duplicatas, persistência, edição e remoção, layout móvel, navegação por teclado, importação com API Google simulada e reprodução de um arquivo real usado apenas como fixture de teste, sem incluí-lo na interface. Há testes de reprodução HTML5 usando bytes reais de uma amostra, alternância de players, erros de autorização, sessões isoladas e expiradas, streaming com Range/206, cancelamento de downloads e restrições de origem. O Google é simulado nos testes de integração: a suíte não valida o login nem o acesso a uma conta Google real.

## Usar seus vídeos

1. Clique em **Adicionar vídeo**.
2. Cole o link de um arquivo de vídeo do Drive (`https://drive.google.com/file/d/ID/view` ou `https://drive.google.com/open?id=ID`). Links de pastas não são aceitos.
3. Escolha um título e um gênero. É possível criar gêneros digitando seus nomes.
4. Selecione o vídeo e aperte play. O modo padrão **Reprodução direta** usa o arquivo original em um player HTML5 do Muvies. O modo **Player do Drive** fica disponível como alternativa.

### Reprodução direta do original

O servidor local transmite o arquivo original ao navegador. Para arquivos públicos, tenta o link público de download. O aplicativo também resolve a confirmação normal de download público de arquivos grandes, mantendo os cookies anônimos apenas durante essa tentativa. Não é necessário Client ID para esse fluxo público. Se o Google realmente exigir login, o aplicativo oferece conectar sua conta e usar a API oficial do Drive com `alt=media`. Arquivos privados exigem uma autorização OAuth com acesso de leitura ao conteúdo (`drive.readonly`). O fato de o navegador estar conectado ao site do Google não autoriza automaticamente a API do Muvies.

O arquivo é transmitido em fluxo, com suporte a pedidos de trechos (`Range` e resposta `206`) para avançar ou voltar no vídeo. Não é necessário baixar o filme inteiro para a memória nem gravá-lo em disco antes de começar. Fechar ou trocar o player cancela a transmissão. O servidor respeita permissões, restrições de download, limites e erros do Google. Segue apenas confirmações normais de download público do mesmo arquivo em endereços reconhecidos do Google; não contorna login, cotas, bloqueios do proprietário ou avisos de arquivo infectado/abusivo. HTML desconhecido não é interpretado como prova de falta de autorização.

O modo direto não usa a prévia convertida do player do Drive. Se o arquivo original já estiver disponível para download e tiver codecs compatíveis com o navegador, pode reproduzir mesmo quando a prévia do Google ainda está em processamento. MP4 com vídeo H.264 e áudio AAC é uma opção amplamente compatível. Alguns arquivos MKV, AVI, HEVC ou com áudio incompatível precisam de conversão ou de um player local como o VLC; o Muvies não converte vídeos.

**Rodar localmente não significa funcionar offline:** os arquivos que estão no Drive ainda precisam de internet para chegar ao seu computador. A aplicação não inclui vídeos de demonstração; somente uma fixture pequena de vídeo fica na pasta de testes.

O modo alternativo **Player do Drive** continua usando a incorporação do Google, com suas próprias regras de processamento, sessão e cookies. O botão **Abrir no Drive** abre o arquivo diretamente no Google. Links que contêm `resourcekey` preservam essa chave de compartilhamento em ambos os modos.

### Legendas SRT

Selecione o vídeo e clique em **Carregar legenda (.srt)** acima do player. Escolha um arquivo SRT do seu computador (até 2 MB). A legenda fica vinculada a esse vídeo, salva em **`.muvies/subtitles/`**, e aparece também nos outros aparelhos que acessam o aplicativo. É possível trocar, mostrar/ocultar ou remover a legenda. Mostrar ou ocultar só altera a sua reprodução; trocar ou remover atualiza o arquivo compartilhado.

As legendas externas funcionam no modo **Reprodução direta**. Ao carregar uma legenda no modo **Player do Drive**, o aplicativo muda para a reprodução direta. O player incorporado do Google não aceita legendas externas enviadas pelo Muvies. O servidor converte SRT para WebVTT, formato de legendas do navegador, preservando tempos, acentos e quebras de linha; marcações de formatação são exibidas como texto. Isso não altera o codec do vídeo.

### Lista salva no aplicativo e compartilhada na rede

Cada link adicionado, título e gênero são gravados em **`.muvies/library.json`**, dentro da pasta do Muvies no computador que executa o servidor. A gravação é confirmada antes de o aplicativo informar que salvou. Fechar o navegador, trocar de aparelho ou reiniciar o servidor não apaga a biblioteca. `npm ci`, builds e atualizações com Git também não removem esse arquivo, que fica fora do controle de versão.

Na primeira abertura, se esse arquivo ainda não existir, o aplicativo importa automaticamente os links da versão anterior guardados no navegador que estiver acessando. Depois disso, o arquivo é a fonte da lista compartilhada; um arquivo de biblioteca intencionalmente vazio permanece vazio. A seleção do último vídeo e o Client ID público podem continuar como preferências locais do navegador.

As telas abertas consultam a mesma biblioteca e as legendas a cada três segundos e ao retornar para a janela. Duas pessoas salvando ao mesmo tempo não sobrescrevem silenciosamente as alterações uma da outra: os dados são atualizados e a pessoa pode conferir e tentar novamente. Remover um link só o remove da lista; o arquivo continua no Drive. Para transferir ou fazer backup da biblioteca e das legendas, copie a pasta `.muvies` com o aplicativo parado. Opcionalmente, a variável `MUVIES_LIBRARY_DIR` define outro diretório de dados; o padrão continua sendo `.muvies` dentro da pasta do aplicativo.

### Acessar de outros aparelhos

Mantenha o Muvies aberto no computador servidor. Nos outros aparelhos da mesma rede, use o endereço **Network** mostrado no terminal, com o IP privado desse computador e a porta 5173. Todos acessam a mesma lista e podem adicionar, editar e remover links. Não use o endereço localhost no outro aparelho, porque ele aponta para o próprio aparelho.

O servidor aceita as APIs de biblioteca e reprodução pública em endereços de loopback ou rede privada, com requisições da própria origem. Ele não precisa de um banco de dados. A autorização pessoal do Google não é compartilhada com a rede: a conexão OAuth só pode ser feita por loopback, no computador servidor. Acesso privado ao Drive continua dependendo das permissões do arquivo e da conta, inclusive ao usar o player alternativo ou abrir o Drive diretamente.

### “Este arquivo de vídeo ainda está sendo processado”

Essa mensagem pertence à prévia do player do Google Drive. Selecione **Reprodução direta** acima do player para usar o original pelo servidor local. Esse modo não depende da conversão da prévia, mas exige que o original esteja disponível para download e seja compatível com o navegador.

Se a reprodução direta pedir autorização, use **Conectar Drive**. Quem usava a versão anterior precisa autorizar novamente: o escopo antigo `drive.metadata.readonly` só permitia listar metadados; o novo `drive.readonly` permite ler o conteúdo dos arquivos. Não basta mudar o nome do escopo no Google Cloud sem fazer uma nova autorização.

Se a conta não puder baixar o arquivo, houver limite de downloads ou o original ainda não estiver disponível, o aplicativo informa o bloqueio. Se o formato não for compatível, use o player alternativo do Drive após o processamento ou baixe o arquivo com sua conta e abra em um player compatível. O aplicativo não altera as permissões dos arquivos.

## Conectar a conta Google

É possível adicionar links sem OAuth e tentar reproduzir arquivos públicos disponíveis para download direto. A confirmação normal de download público de arquivos grandes é tratada sem Client ID. Para ler arquivos privados, acessar links que realmente exigem autorização e importar a biblioteca:

1. Crie um projeto no Google Cloud e ative a **Google Drive API**.
2. Configure a tela de consentimento OAuth. Se o aplicativo estiver em modo de teste, cadastre sua conta como usuário de teste.
3. Crie uma credencial OAuth do tipo **Aplicativo da Web**. Adicione a origem exata usada para abrir o Muvies às **Origens JavaScript autorizadas**. A janela de conexão mostra essa origem. Em produção, use HTTPS. Em desenvolvimento, o Google permite uma origem localhost.
4. Cadastre o escopo `https://www.googleapis.com/auth/drive.readonly` na configuração de acesso a dados. Essa permissão dá acesso de leitura ao conteúdo dos arquivos, não somente aos metadados.
5. No Muvies, clique em **Conectar Drive**, informe o **Client ID** público e continue com o Google. Autorize a nova permissão de leitura mesmo se já usava a versão anterior. Não forneça Client Secret, senha ou token.

O login usa Google Identity Services. O token é enviado pela aplicação ao servidor que roda na sua máquina e fica somente na memória dele, por no máximo uma hora ou até o processo encerrar. Ele não é gravado em disco, no `localStorage`, em URLs do vídeo ou em logs. O navegador recebe apenas um identificador aleatório de sessão em cookie `HttpOnly` e `SameSite=Strict`. Os links da biblioteca ficam no arquivo compartilhado do aplicativo; somente o Client ID público e a seleção local ficam no navegador. Ao reiniciar o servidor ou expirar a autorização, conecte o Drive novamente.

A permissão é de leitura: o aplicativo não altera nem exclui arquivos. A importação é paginada e mantém os títulos e gêneros já editados. **Sincronizar Drive** solicita uma nova autorização e atualiza a lista. A conexão OAuth só aceita loopback. A biblioteca e downloads públicos aceitam também IPs privados da rede e requisições da mesma origem; ele não funciona como um proxy público de URLs arbitrárias. Não exponha esse servidor pessoal na internet.

A integração real depende do seu projeto OAuth e da autorização da sua conta. Ela não foi validada com uma conta real neste ambiente. Apps externos em produção podem exigir verificação do Google conforme o escopo e o público configurados.

## Rodar o build local

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

O comando de preview também inclui o servidor de transmissão local. Se usar a conexão Google nessa porta, inclua essa origem na credencial OAuth. Publicar somente `dist/` em uma hospedagem estática não inclui as rotas de streaming: esta versão foi feita para rodar localmente com Node.js e Vite, como servidor pessoal.

As fontes e o ícone do aplicativo são locais. A conexão Google usa `accounts.google.com`, `www.googleapis.com` e `www.gstatic.com`. Downloads públicos podem usar `drive.google.com`, `drive.usercontent.google.com` e redirecionamentos para `*.googleusercontent.com`. O player alternativo do Google pode usar também `*.googlevideo.com`. Na nuvem, esses destinos precisam estar liberados nas configurações de rede. Em uma instalação local, valem as regras de rede da sua máquina.

## Créditos

- **Fixture de testes (Flower)**: arquivo de aproximadamente 5 segundos em `tests/fixtures/native-video.mp4`, proveniente do [MDN Interactive Examples](https://github.com/mdn/interactive-examples/tree/main/live-examples/media/cc0-videos), domínio público, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Usado somente pelos testes; não é servido como demonstração do aplicativo.
- **DM Sans** e **Manrope**: fontes distribuídas via Fontsource sob a SIL Open Font License.
- Ícones: Lucide, licença ISC.

Não há vínculo oficial entre Muvies, Google ou Blender Foundation.

## Rede com proxy

Em ambientes Node.js 24 configurados com `HTTP_PROXY`/`HTTPS_PROXY`, ative o proxy do próprio Node ao iniciar o servidor: `NODE_USE_ENV_PROXY=1 npm run dev`. Isso foi validado no ambiente de nuvem, preservando a verificação TLS e o certificado adicional já fornecido pelo ambiente. Na sua máquina, sem proxy, o comando normal `npm run dev` continua válido.
