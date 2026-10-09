// premio/premio.js
// Formulário do ganhador de sorteio: valida na tela, busca o CEP no ViaCEP,
// guarda rascunho neste aparelho e envia para o dashboard
// (POST /api/public/premio). Nada de dado pessoal vai para analytics.
(function () {
  'use strict';

  var API = 'https://dashboard.rodrigorosar.com.br/api/public/premio';
  var VIACEP = 'https://viacep.com.br/ws/';
  var RASCUNHO = 'premio-rascunho-v1';
  // Acima do maxDuration da rota (30 s): abortar antes faria a pessoa reenviar algo já gravado.
  var PRAZO_ENVIO_MS = 35000;
  var PRAZO_CEP_MS = 5000;
  var UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  var CAMPOS_TEXTO = ['nome', 'instagram', 'email', 'whatsapp', 'cep', 'logradouro', 'numero', 'complemento',
    'bairro', 'cidade', 'uf', 'pais', 'endereco-completo'];
  var MSG = {
    obrigatorio: 'Preencha este campo.',
    nome: 'Escreva seu nome completo.',
    instagram: 'Use só letras, números, ponto e _ no @.',
    email: 'Confira o e-mail: parece que falta algo.',
    whatsapp: 'Informe o WhatsApp com DDD.',
    cep: 'Informe um CEP com 8 números.',
    uf: 'Escolha o estado.',
    consentimento: 'Para enviar, marque a autorização.'
  };

  var inicio = Date.now();
  // Tempo já gasto antes de recarregar a página (vem do rascunho): quem volta com tudo
  // preenchido e envia em 2 s não é robô.
  var tempoAnteriorS = 0;
  var form = document.getElementById('formulario-premio');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var exterior = $('mora-exterior');
  var preenchidoPeloCep = {};

  // ---------- rascunho no aparelho ----------
  function lerRascunho() {
    try { return JSON.parse(localStorage.getItem(RASCUNHO) || 'null'); } catch (e) { return null; }
  }
  function salvarRascunho() {
    var dados = { exterior: exterior.checked, tempoS: tempoTotalS() };
    CAMPOS_TEXTO.forEach(function (id) { dados[id] = $(id).value; });
    try { localStorage.setItem(RASCUNHO, JSON.stringify(dados)); } catch (e) { /* modo privado: segue sem rascunho */ }
  }
  function apagarRascunho() {
    try { localStorage.removeItem(RASCUNHO); } catch (e) { /* idem */ }
  }
  function restaurar() {
    var r = lerRascunho();
    if (!r || typeof r !== 'object') return;
    CAMPOS_TEXTO.forEach(function (id) { if (typeof r[id] === 'string') $(id).value = r[id]; });
    exterior.checked = r.exterior === true;
    if (typeof r.tempoS === 'number' && r.tempoS >= 0 && r.tempoS < 86400) tempoAnteriorS = Math.floor(r.tempoS);
  }
  function tempoTotalS() {
    return tempoAnteriorS + Math.round((Date.now() - inicio) / 1000);
  }

  // ---------- máscaras ----------
  function digitos(v) { return String(v || '').replace(/\D/g, ''); }
  function mascaraCep(v) {
    var d = digitos(v).slice(0, 8);
    return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  }
  function mascaraWhatsapp(v) {
    if (/^\s*\+/.test(v) && !/^\s*\+\s*55/.test(v)) return v; // número de fora: como digitado
    var d = digitos(v).replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function limparInstagram(v) {
    var t = String(v || '').trim();
    var url = t.match(/instagram\.com\/([^/?#\s]+)/i);
    if (url) t = url[1];
    return t.replace(/^@+/, '').toLowerCase();
  }

  // ---------- exterior / Brasil ----------
  function aplicarExterior() {
    $('bloco-brasil').hidden = exterior.checked;
    $('bloco-exterior').hidden = !exterior.checked;
  }

  // ---------- CEP (ViaCEP) ----------
  function preencherSeVazio(id, valor) {
    var campo = $(id);
    if (!valor) return;
    if (campo.value.trim() === '' || preenchidoPeloCep[id] === campo.value) {
      campo.value = valor;
      preenchidoPeloCep[id] = valor;
      limparErro(campo);
    }
  }
  function buscarCep() {
    var cep = digitos($('cep').value);
    var status = $('status-cep');
    if (cep.length !== 8) { status.textContent = ''; return; }
    status.textContent = 'Buscando endereço…';
    var controle = typeof AbortController === 'function' ? new AbortController() : null;
    var prazo = setTimeout(function () { if (controle) controle.abort(); }, PRAZO_CEP_MS);
    fetch(VIACEP + cep + '/json/', controle ? { signal: controle.signal } : {})
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http')); })
      .then(function (d) {
        if (digitos($('cep').value) !== cep) return; // a pessoa já mudou o CEP
        if (!d || d.erro) { status.textContent = 'CEP não encontrado. Preencha o endereço abaixo.'; return; }
        preencherSeVazio('logradouro', d.logradouro);
        preencherSeVazio('bairro', d.bairro);
        preencherSeVazio('cidade', d.localidade);
        if (UFS.indexOf(d.uf) >= 0) preencherSeVazio('uf', d.uf);
        status.textContent = 'Endereço encontrado. Confira e complete o número.';
        salvarRascunho();
        if (!$('numero').value) $('numero').focus();
      })
      .catch(function () {
        status.textContent = 'Não conseguimos buscar o CEP agora. Preencha o endereço abaixo.';
      })
      .then(function () { clearTimeout(prazo); });
  }

  // ---------- erros na tela ----------
  function idDoErro(chave) { return 'erro-' + chave.replace('.', '-'); }
  function campoDaChave(chave) {
    var mapa = { 'endereco.enderecoCompleto': 'endereco-completo' };
    if (mapa[chave]) return $(mapa[chave]);
    return $(chave.indexOf('endereco.') === 0 ? chave.slice(9) : chave);
  }
  function mostrarErro(chave, mensagem) {
    var alvo = $(idDoErro(chave));
    var campo = campoDaChave(chave);
    if (alvo) alvo.textContent = mensagem;
    if (campo) campo.setAttribute('aria-invalid', 'true');
  }
  function limparErro(campo) {
    campo.removeAttribute('aria-invalid');
    var ids = (campo.getAttribute('aria-describedby') || '').split(' ');
    ids.forEach(function (id) { if (id.indexOf('erro-') === 0 && $(id)) $(id).textContent = ''; });
  }
  function limparTodos() {
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), limparErro);
    Array.prototype.forEach.call(form.querySelectorAll('.erro-campo'), function (p) { p.textContent = ''; });
    $('aviso-envio').textContent = '';
  }
  function aviso(texto) {
    var p = document.createElement('p');
    p.className = 'aviso aviso--erro';
    p.textContent = texto;
    var caixa = $('aviso-envio');
    caixa.textContent = '';
    caixa.appendChild(p);
  }
  function focarPrimeiroErro() {
    var primeiro = form.querySelector('[aria-invalid=true]');
    if (primeiro) primeiro.focus();
  }

  // ---------- validação na tela (o servidor valida de novo) ----------
  function validar() {
    var erros = {};
    var v = function (id) { return $(id).value.trim(); };
    if (v('nome').replace(/\s+/g, ' ').length < 3) erros.nome = MSG.nome;
    var ig = limparInstagram(v('instagram'));
    if (!ig) erros.instagram = MSG.obrigatorio;
    else if (!/^[a-z0-9._]{1,30}$/.test(ig)) erros.instagram = MSG.instagram;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) erros.email = MSG.email;
    var tel = digitos(v('whatsapp'));
    if (tel.length < 10 || tel.length > 15) erros.whatsapp = MSG.whatsapp;
    if (exterior.checked) {
      if (v('pais').length < 2) erros['endereco.pais'] = MSG.obrigatorio;
      if (v('endereco-completo').length < 10) erros['endereco.enderecoCompleto'] = 'Escreva o endereço completo.';
    } else {
      if (digitos(v('cep')).length !== 8) erros['endereco.cep'] = MSG.cep;
      if (v('logradouro').length < 2) erros['endereco.logradouro'] = MSG.obrigatorio;
      if (!v('numero')) erros['endereco.numero'] = MSG.obrigatorio;
      if (v('bairro').length < 2) erros['endereco.bairro'] = MSG.obrigatorio;
      if (v('cidade').length < 2) erros['endereco.cidade'] = MSG.obrigatorio;
      if (UFS.indexOf(v('uf')) < 0) erros['endereco.uf'] = MSG.uf;
    }
    if (!$('consentimento').checked) erros.consentimento = MSG.consentimento;
    return erros;
  }

  function montarCorpo() {
    var v = function (id) { return $(id).value; };
    var endereco = exterior.checked
      ? { moraExterior: true, pais: v('pais'), enderecoCompleto: v('endereco-completo') }
      : { moraExterior: false, cep: v('cep'), logradouro: v('logradouro'), numero: v('numero'),
          complemento: v('complemento'), bairro: v('bairro'), cidade: v('cidade'), uf: v('uf') };
    var corpo = {
      nome: v('nome'), instagram: v('instagram'), email: v('email'), whatsapp: v('whatsapp'),
      endereco: endereco, consentimento: $('consentimento').checked,
      tempoPreenchimentoS: Math.min(tempoTotalS(), 86400)
    };
    if ($('empresa_site').value) corpo.empresa_site = $('empresa_site').value;
    return corpo;
  }

  // ---------- sucesso ----------
  var CORES_CONFETE = ['#0F766E', '#2DD4BF', '#F59E0B', '#EC4899', '#8B5CF6', '#3B82F6'];
  /** Confete decorativo da confirmação (some com prefers-reduced-motion, pelo CSS). */
  function festa() {
    var caixa = document.createElement('div');
    caixa.className = 'festa';
    caixa.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 22; i += 1) {
      var peca = document.createElement('i');
      var angulo = (Math.PI * 2 * i) / 22;
      var distancia = 90 + Math.random() * 90;
      peca.style.background = CORES_CONFETE[i % CORES_CONFETE.length];
      peca.style.setProperty('--x', Math.round(Math.cos(angulo) * distancia) + 'px');
      peca.style.setProperty('--y', Math.round(Math.sin(angulo) * distancia + 60) + 'px');
      peca.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
      peca.style.animationDelay = Math.round(Math.random() * 120) + 'ms';
      caixa.appendChild(peca);
    }
    return caixa;
  }

  function mostrarSucesso(primeiroNome) {
    apagarRascunho();
    var app = $('app');
    var caixa = document.createElement('div');
    caixa.className = 'sucesso';
    var icone = document.createElement('div');
    icone.className = 'sucesso__icone';
    icone.setAttribute('aria-hidden', 'true');
    icone.textContent = '📚';
    var titulo = document.createElement('h2');
    titulo.tabIndex = -1;
    titulo.textContent = primeiroNome ? 'Prontinho, ' + primeiroNome + '!' : 'Prontinho!';
    var p1 = document.createElement('p');
    p1.textContent = 'Recebemos o seu endereço. Agora é com a gente: vamos comprar o seu livro e enviar para você.';
    var p2 = document.createElement('p');
    p2.textContent = 'Se precisarmos confirmar alguma coisa, falamos com você pelo Instagram ou pelo WhatsApp.';
    [festa(), icone, titulo, p1, p2].forEach(function (n) { caixa.appendChild(n); });
    app.textContent = '';
    app.appendChild(caixa);
    titulo.focus();
  }

  // ---------- envio ----------
  function enviar(evento) {
    evento.preventDefault();
    limparTodos();
    var erros = validar();
    var chaves = Object.keys(erros);
    if (chaves.length) {
      chaves.forEach(function (k) { mostrarErro(k, erros[k]); });
      aviso('Confira os campos destacados.');
      focarPrimeiroErro();
      return;
    }
    var botao = $('botao-enviar');
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    var controle = typeof AbortController === 'function' ? new AbortController() : null;
    var prazo = setTimeout(function () { if (controle) controle.abort(); }, PRAZO_ENVIO_MS);
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(montarCorpo()),
      signal: controle ? controle.signal : undefined
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, dados: d }; });
      })
      .then(function (res) {
        if (res.status === 201 && res.dados.ok) { mostrarSucesso(res.dados.primeiroNome); return; }
        if (res.status === 400 && res.dados.campos) {
          var semLugar = [];
          Object.keys(res.dados.campos).forEach(function (k) {
            if ($(idDoErro(k))) mostrarErro(k, res.dados.campos[k]);
            else semLugar.push(res.dados.campos[k]);
          });
          // Erro sem campo na tela (ex.: envio adulterado): vai no aviso, nunca some.
          aviso(semLugar.length ? 'Não conseguimos ler o envio. Recarregue a página e tente de novo.'
            : (res.dados.erro || 'Confira os campos destacados.'));
          focarPrimeiroErro();
          return;
        }
        aviso(res.dados.erro || 'Não conseguimos enviar agora. Seus dados continuam aqui; tente de novo em instantes.');
      })
      .catch(function () {
        aviso('Sem conexão com o servidor. Seus dados continuam aqui; confira a internet e tente de novo.');
      })
      .then(function () {
        clearTimeout(prazo);
        if (document.body.contains(botao)) {
          botao.disabled = false;
          botao.textContent = 'Enviar meu endereço';
        }
      });
  }

  // ---------- ligações ----------
  restaurar();
  aplicarExterior();
  exterior.addEventListener('change', function () { aplicarExterior(); salvarRascunho(); });
  $('cep').addEventListener('input', function () {
    this.value = mascaraCep(this.value);
    if (digitos(this.value).length === 8) buscarCep();
  });
  $('whatsapp').addEventListener('blur', function () { this.value = mascaraWhatsapp(this.value); });
  $('instagram').addEventListener('blur', function () {
    var limpo = limparInstagram(this.value);
    this.value = limpo ? '@' + limpo : '';
  });
  form.addEventListener('input', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) limparErro(e.target);
    salvarRascunho();
  });
  form.addEventListener('change', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) limparErro(e.target);
  });
  form.addEventListener('submit', enviar);
}());
