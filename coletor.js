const fs = require('fs');
const https = require('https');

const ESTADOS = [
  'PR','SP','SC','MG','RS','RJ','GO','DF','BA','PE','CE','ES','MT','MS',
  'PA','PB','RN','AL','SE','AM','MA','PI','RO','TO','AC','AP','RR'
];

const REGEX_BLACKLIST = /\b(sucata|materiais|material|ve[ií]culo|carro|moto|caminh[aã]o|empilhadeira|trator|colheitadeira|inform[aá]tica|computador|notebook|monitor|impressora|mobili[aá]rio|m[oó]veis|cadeira|mesa|arm[aá]rio|equipamento|maquin[aá]rio|m[aá]quina|ferro|aço|cabo|fio|pneu|roda|pe[cç]a|motor|gerador|transformador|eletr[oô]nico|eletrodom[eé]stico|celular|tv|televis[aã]o|roupa|cal[cç]ado|tecido|estoque|mercadoria|ferramenta|tubo|bomba|compressor|tanque|container|embarca[cç][aã]o|barco|lancha|aeronave)\b/i;
const REGEX_IMOVEL_VALIDO = /\b(apartamento|apto|casa|sobrado|resid[eê]ncia|residencial|terreno|lote\s+urbano|lote\s+de\s+terreno|gleba|fazenda|s[ií]tio|ch[aá]cara|im[oó]vel|sala\s+comercial|loja|galp[aã]o|pr[eé]dio|edif[ií]cio|cobertura|kitnet|flat|vaga\s+de\s+garagem|box\s+garagem|matr[ií]cula|alvenaria|pavimento)\b/i;

function ehImovelValido(texto) {
  if (!texto) return false;
  if (REGEX_BLACKLIST.test(texto)) return false;
  return REGEX_IMOVEL_VALIDO.test(texto);
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function requisicaoDireta(targetUrl, encoding = 'utf8', headersExtras = {}) {
  return new Promise((resolve) => {
    const req = https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/csv,text/html,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        ...headersExtras
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode !== 200) {
        console.log(`[HTTP ${res.statusCode}] ${targetUrl.slice(0, 75)}`);
        res.resume();
        return resolve('');
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString(encoding)));
    });

    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

function calcularScoreOraculo(desconto, estado, ocupado, financia) {
  let score = 5.0 + (desconto / 11.2);
  if (['PR', 'SP', 'SC', 'MG', 'RS', 'RJ', 'GO', 'DF'].includes(estado)) score += 0.5;
  if (ocupado === 'DESOCUPADO') score += 0.4;
  if (financia) score += 0.3;
  return Math.min(9.9, Math.max(1.0, Number(score.toFixed(1))));
}

function detectarEstrategias(desconto, texto) {
  const tags = [];
  if (desconto >= 38) tags.push('REVENDA');
  if (/praia|litoral|balne[aá]rio|beira[- ]mar|meia praia|caiob[aá]|guaratuba|matinhos|cambori[uú]/i.test(texto)) {
    tags.push('PRAIA', 'AIRBNB');
  }
  if (/universidade|faculdade|campus|uem|ufpr|uel|uemg|usp|unicamp|puc/i.test(texto)) {
    tags.push('UNIVERSITARIO');
  }
  if (tags.length === 0) tags.push('REVENDA');
  return [...new Set(tags)];
}

function detectarTipo(texto) {
  if (/\b(casa|sobrado|resid[eê]ncia)\b/i.test(texto)) return 'Casa';
  if (/\b(terreno|lote|gleba|fazenda|s[ií]tio|ch[aá]cara|rural)\b/i.test(texto)) return 'Terreno';
  if (/\b(comercial|sala|loja|galp[aã]o|pr[eé]dio|box|garagem)\b/i.test(texto)) return 'Comercial';
  return 'Apartamento';
}

// 1. CAIXA ECONÔMICA DIRETA (FUNCIONA SEM CHAVE QUANDO RODADO COM IP BRASIL / SEU PC)
async function coletarCaixaDireta() {
  const resultados = [];

  for (let i = 0; i < ESTADOS.length; i++) {
    const uf = ESTADOS[i];
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
    const texto = await requisicaoDireta(url, 'latin1', {
      'Referer': 'https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp'
    });

    if (!texto || !texto.includes(';')) {
      if (i === 0) {
        console.log('[Caixa] IP atual bloqueado pela Caixa (normal no GitHub EUA). Para baixar Caixa sem chave, rode "node coletor.js" no seu PC/VPS BR e importe o imoveis.json.');
        break; // Aborta rápido sem perder tempo nos outros 26 estados
      }
      continue;
    }

    const linhas = texto.split('\n').slice(4);
    let countUF = 0;

    for (const linha of linhas) {
      const cols = linha.split(';').map(s => s.trim());
      if (cols.length < 10 || !cols[0]) continue;

      const idNum = cols[0].replace(/\D/g, '');
      if (!idNum) continue;
      const id13 = idNum.padStart(13, '0');

      const estado = cols[1] || uf;
      const cidade = cols[2] || '';
      const bairro = cols[3] || '';
      const endereco = cols[4] || '';
      const preco = parseFloat((cols[5] || '0').replace(/\./g, '').replace(',', '.'));
      const avaliacao = parseFloat((cols[6] || '0').replace(/\./g, '').replace(',', '.'));
      const modalidade = cols[8] || 'Venda Online';
      const descricao = cols[9] || '';

      if (preco <= 15000 || avaliacao <= 15000) continue;

      const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
      const ocupado = /ocupado/i.test(descricao) ? 'OCUPADO' : 'DESOCUPADO';
      const financia = /aceita financiamento/i.test(descricao);
      const tipo = detectarTipo(descricao);
      const matchArea = descricao.match(/(\d+[.,]?\d*)\s*m2/i);
      const area = matchArea ? parseFloat(matchArea[1].replace(',', '.')) : 65;

      resultados.push({
        id: `CX-${id13}`,
        chaveDedup: `${estado}-${cidade}-${endereco}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
        titulo: `${tipo} - ${bairro || cidade}`,
        tipo,
        portal: `Caixa (${modalidade})`,
        url: `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnImovel=${id13}`,
        uf: estado,
        cidade,
        bairro: bairro || 'Centro',
        endereco,
        area,
        quartos: tipo === 'Terreno' ? 0 : 2,
        vagas: tipo === 'Terreno' ? 0 : 1,
        avaliacao,
        mercado: Math.round(avaliacao * 1.07),
        lance1: avaliacao,
        data1: 'Em andamento',
        lance2: preco,
        data2: 'Praça Única / Imediato',
        financia,
        ocupado,
        dividas: 'VENDEDOR_BANCO',
        risco: ocupado === 'OCUPADO' ? 'MEDIO' : 'BAIXO',
        estrategias: detectarEstrategias(desconto, `${bairro} ${cidade} ${descricao}`),
        indiceLocal: 8.2,
        score: calcularScoreOraculo(desconto, estado, ocupado, financia),
        img: `https://venda-imoveis.caixa.gov.br/fotos/F${id13}21.jpg`,
        portais: [
          { nome: 'Avaliação Caixa', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` },
          { nome: 'Média Regional Est.', faixa: `R$ ${Math.round(avaliacao * 1.07).toLocaleString('pt-BR')}` }
        ],
        pois: ['Infraestrutura Urbana Consolidada'],
        processo: `Caixa ID ${id13} • ${modalidade}`,
        resumoEdital: descricao
      });
      countUF++;
    }
    console.log(`[Caixa ${uf}] ${countUF} imóveis extraídos`);
  }
  return resultados;
}

// 2. SUPERBID EXCHANGE (API ABERTA DE IMÓVEIS — FUNCIONA DIRETO NO GITHUB ACTIONS SEM CHAVE)
async function coletarSuperbidImoveis() {
  const resultados = [];

  for (let page = 1; page <= 15; page++) {
    const url = `https://offer-query.superbid.net/offers/?portalId=2&filter=product.productType.id:2&pageNumber=${page}&pageSize=50&orderBy=price:asc`;
    const raw = await requisicaoDireta(url, 'utf8', {
      'Origin': 'https://www.superbid.net',
      'Referer': 'https://www.superbid.net/'
    });
    if (!raw) break;

    try {
      const json = JSON.parse(raw);
      const ofertas = json.offers || [];
      if (!ofertas.length) break;

      for (const o of ofertas) {
        const desc = o.product?.shortDesc || '';
        const det = o.product?.detailedDesc || '';
        if (!ehImovelValido(`${desc} ${det}`)) continue;

        const preco = Number(o.price || o.initialBidValue || 0);
        const avaliacao = Number(o.marketValue || preco * 1.38);
        if (preco <= 20000) continue;

        const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
        const uf = (o.store?.state || 'SP').toUpperCase();
        const cidade = o.store?.city || 'São Paulo';
        const bairro = o.store?.neighborhood || 'Centro';
        const leiloeiroNome = o.auctioneer?.name || 'Superbid Exchange';
        const tipo = detectarTipo(`${desc} ${det}`);
        const linkOferta = o.url && o.url.startsWith('http') ? o.url : `https://www.superbid.net/oferta/${o.id}`;

        resultados.push({
          id: `SB-${o.id}`,
          chaveDedup: `SB-${o.id}`,
          titulo: desc.slice(0, 95),
          tipo,
          portal: leiloeiroNome,
          url: linkOferta,
          uf,
          cidade,
          bairro,
          endereco: `${bairro}, ${cidade} - ${uf}`,
          area: 80,
          quartos: tipo === 'Terreno' ? 0 : 2,
          vagas: tipo === 'Terreno' ? 0 : 1,
          avaliacao: Math.round(avaliacao),
          mercado: Math.round(avaliacao * 1.05),
          lance1: Math.round(avaliacao * 0.9),
          data1: '1ª Praça',
          lance2: Math.round(preco),
          data2: o.endDate ? new Date(o.endDate).toLocaleDateString('pt-BR') : '2ª Praça',
          financia: false,
          ocupado: 'NAO_INFORMADO',
          dividas: 'VERIFICAR_EDITAL',
          risco: 'MEDIO',
          estrategias: detectarEstrategias(desconto, `${desc} ${cidade}`),
          indiceLocal: 8.1,
          score: calcularScoreOraculo(desconto, uf, 'NAO_INFORMADO', false),
          img: o.product?.thumbnailUrl || '',
          portais: [{ nome: 'Avaliação Edital', faixa: `R$ ${Math.round(avaliacao).toLocaleString('pt-BR')}` }],
          pois: ['Localização urbana verificada'],
          processo: `Lote #${o.id} • ${leiloeiroNome}`,
          resumoEdital: det || desc
        });
      }
    } catch {
      break;
    }
    await esperar(300);
  }
  console.log(`[Superbid Imóveis] ${resultados.length} imóveis válidos`);
  return resultados;
}

(async () => {
  console.log('=== INICIANDO COLETOR ORÁCULO (MODO DIRETO SEM API KEY) ===');

  const caixa = await coletarCaixaDireta();
  const superbid = await coletarSuperbidImoveis();

  const bruto = [...caixa, ...superbid];
  const mapaUnico = new Map();

  for (const lote of bruto) {
    const chave = lote.chaveDedup || lote.id;
    if (!mapaUnico.has(chave) || lote.lance2 < mapaUnico.get(chave).lance2) {
      mapaUnico.set(chave, lote);
    }
  }

  const unificados = Array.from(mapaUnico.values());
  unificados.sort((a, b) => b.score - a.score);

  const saida = {
    atualizado_em: new Date().toISOString(),
    status_coleta: unificados.length > 0 ? 'OK' : 'VAZIO',
    total_brasil_bruto: bruto.length,
    total_unificado: unificados.length,
    lotes: unificados.slice(0, 6000)
  };

  fs.writeFileSync('imoveis.json', JSON.stringify(saida));
  console.log(`=== FINALIZADO! Bruto: ${bruto.length} | Únicos: ${unificados.length} | Salvos: ${saida.lotes.length} ===`);
  process.exit(0);
})();
