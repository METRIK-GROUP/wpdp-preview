// credenciamento/carga.js
// Busca do cardápio (buscarFormulario) e a resiliência da CARGA do
// formulário: logo depois de um deploy do dashboard (ou de um período
// ocioso), a primeira resposta do servidor pode demorar dezenas de segundos
// para "acordar" (cold start) — visto em produção: 38,9 s e 19,4 s na
// primeira resposta, 0,2 s depois. Sem isso, a pessoa via "Não conseguimos
// carregar o formulário agora" por um problema que se resolvia sozinho no
// servidor em segundos.
//
// buscarComRetentativa tenta de novo (uma vez só, automático, sem ação da
// pessoa) quando a falha é passageira — prazo esgotado ou rede — e também
// quando o servidor respondeu 5xx (o problema é dele, pode ter sido só o
// cold start); NUNCA tenta de novo em 4xx, porque é uma resposta REAL do
// servidor sobre o pedido em si. Enquanto espera, se passar de ~8 s (as duas
// tentativas somadas, sem reiniciar a contagem na retentativa), mostra uma
// mensagem calma perto do esqueleto — só para a pessoa saber que a página
// não travou.
//
// buscarFormulario é usada tanto na carga inicial (tela.js: carregar())
// quanto na busca sem cache do 409 (envio.js: tratar409(), que recebe a
// função por injeção) — as duas compartilham o mesmo prazo de 45 s por
// tentativa (LIMITE_CARGA_MS); só a carga inicial tenta de novo e mostra a
// mensagem de espera (o 409 já tem o próprio aviso, "Recarregue a página" —
// continua do jeito que está, sem mudar aqui).
//
// Fábrica congelada, como envio.js/protecao.js: tela.js cria e usa; nenhum
// estado global novo.
(function () {
  'use strict';

  // Prazo de CADA tentativa da carga do formulário (cobre o cold start acima
  // com folga). O POST do envio segue com o prazo dele (35 s, em envio.js) e
  // a busca de CEP com o dela (5 s, em tela.js): nenhum dos dois muda aqui.
  var LIMITE_CARGA_MS = 45000;
  var ESPERA_MENSAGEM_MS = 8000;
  var MENSAGEM_ESPERA = 'Carregando o formulário… pode levar alguns segundos.';

  window.CredCarga = Object.freeze({
    LIMITE_CARGA_MS: LIMITE_CARGA_MS,
    /**
     * @param {object} ctx
     * @param {object} ctx.N - window.CredNucleo
     * @param {Function} ctx.el - helper de criação de elemento (tela.js)
     * @param {Function} ctx.buscar - fetch com prazo (tela.js: `buscar(url, opcoes, limite)`)
     * @param {HTMLElement} ctx.app - #app (a mensagem de espera nasce ao lado do esqueleto)
     * @returns {{ buscarFormulario: Function, buscarComRetentativa: Function }}
     */
    criar: function (ctx) {
      var N = ctx.N;
      var el = ctx.el;
      var buscar = ctx.buscar;
      var app = ctx.app;

      /**
       * Busca o cardápio no servidor e confere o formato mínimo. Usada tanto
       * na carga inicial quanto na recuperação do 409 (I-1) — nesse segundo
       * caso, `semCache: true` força ignorar o cache da CDN (query
       * descartável + `cache: 'no-store'`), porque um 409 significa que o
       * cardápio ACABOU de mudar no servidor e a resposta antiga em cache
       * não serviria.
       */
      function buscarFormulario(opcoes) {
        var semCache = !!(opcoes && opcoes.semCache);
        var url = N.apiBase(window.location) + '/api/public/credenciamento/formulario';
        if (semCache) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
        var init = { headers: { Accept: 'application/json' } };
        if (semCache) init.cache = 'no-store';
        return buscar(url, init, LIMITE_CARGA_MS).then(function (res) {
          if (!res.ok) {
            var erroHttp = new Error('HTTP ' + res.status);
            erroHttp.status = res.status; // deveTentarDeNovo: só 5xx tenta de novo, nunca 4xx
            throw erroHttp;
          }
          if (!N.formularioValido(res.dados)) {
            var erroFormato = new Error('formato inesperado'); // C4: exige edição e versão
            erroFormato.semTentarDeNovo = true; // 200 mas fora do formato: tentar de novo não ajudaria
            throw erroFormato;
          }
          return res.dados;
        });
      }

      /** 4xx é resposta real do servidor (nunca tenta de novo); prazo esgotado, rede e 5xx tentam. */
      function deveTentarDeNovo(erro) {
        if (!erro || erro.semTentarDeNovo) return false;
        if (typeof erro.status === 'number') return erro.status >= 500;
        return true; // AbortError (prazo) ou falha de rede: chegam sem nenhum "status"
      }

      /** Mensagem calma perto do esqueleto; só texto, some com pararEspera(). */
      function mostrarMensagemDeEspera() {
        return el('p', { classe: 'ajuda', id: 'carregando-espera', 'aria-live': 'polite', texto: MENSAGEM_ESPERA });
      }

      /**
       * Envolve `tentar` (uma chamada a buscarFormulario) com UMA
       * retentativa automática em falha passageira, e a mensagem de espera
       * se as duas tentativas somadas passarem de ~8 s. Resolve ou rejeita
       * com o mesmo formato de `tentar()`.
       */
      function buscarComRetentativa(tentar) {
        var mensagem = null;
        var relogio = setTimeout(function () {
          mensagem = mostrarMensagemDeEspera();
          app.appendChild(mensagem);
        }, ESPERA_MENSAGEM_MS);
        function pararEspera() {
          clearTimeout(relogio);
          if (mensagem && mensagem.parentNode) mensagem.parentNode.removeChild(mensagem);
          mensagem = null;
        }
        function comSucesso(dados) {
          pararEspera();
          return dados;
        }
        function comFalhaFinal(erro) {
          pararEspera();
          throw erro;
        }
        return tentar().then(comSucesso, function (erro) {
          if (!deveTentarDeNovo(erro)) return comFalhaFinal(erro);
          return tentar().then(comSucesso, comFalhaFinal);
        });
      }

      return { buscarFormulario: buscarFormulario, buscarComRetentativa: buscarComRetentativa };
    },
  });
})();
