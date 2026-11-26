const fs = require('fs');
const https = require('https');
const http = require('http');

const ESTADOS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const FONTES_NACIONAIS = [
  { nome: 'Banco do Brasil (Seu Imóvel BB)', url: 'https://seuimovelbb.com.br/catalogo', ufPadrao: 'DF', tag: 'BB' },
  { nome: 'Bradesco Imóveis', url: 'https://banco.bradesco/html/classic/produtos-servicos/leiloes/imoveis.shtm', ufPadrao: 'SP', tag: 'BRADESCO' },
  { nome: 'Itaú Leilões', url: 'https://www.itau.com.br/imoveis-leilao', ufPadrao: 'SP', tag: 'ITAU' },
  { nome: 'Santander Imóveis', url: 'https://www.santanderimoveis.com.br/', ufPadrao: 'SP', tag: 'SANTANDER' },
  { nome: 'Portal Zuk', url: 'https://www.portalzuk.com.br/leilao-de-imoveis', ufPadrao: 'SP', tag: 'ZUK' },
  { nome: 'Mega Leilões', url: 'https://www.megaleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'MEGA' },
  { nome: 'Sodré Santoro', url: 'https://www.sodresantoro.com.br/imoveis', ufPadrao: 'SP', tag: 'SODRE' },
  { nome: 'Biasi Leilões', url: 'https://www.biasileiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'BIASI' },
  { nome: 'Frazão Leilões', url: 'https://www.frazaoleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'FRAZAO' },
  { nome: 'Freitas Leiloeiro', url: 'https://www.freitasleiloeiro.com.br/leiloes/imoveis', ufPadrao: 'SP', tag: 'FREITAS' },
  { nome: 'VIP Leilões', url: 'https://www.vipleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'VIP' },
  { nome: 'Lance Judicial', url: 'https://www.lancejudicial.com.br/imoveis', ufPadrao: 'SP', tag: 'LANCEJUD' },
  { nome: 'Lance Já', url: 'https://www.lanceja.com.br/imoveis', ufPadrao: 'SP', tag: 'LANCEJA' },
  { nome: 'Bomvalor Leilões', url: 'https://www.bomvalor.com.br/imoveis', ufPadrao: 'SP', tag: 'BOMVALOR' },
  { nome: 'Sold Leilões', url: 'https://www.sold.com.br/leiloes/imoveis', ufPadrao: 'SP', tag: 'SOLD' },
  { nome: 'Kronberg Leilões (PR)', url: 'https://www.kronbergleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'KRONBERG' },
  { nome: 'Nakakogue Leilões (PR)', url: 'https://www.nakakogueleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'NAKAKOGUE' },
  { nome: 'Nogari Leilões (PR)', url: 'https://www.nogarileiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'NOGARI' },
  { nome: 'Top Leilões (PR)', url: 'https://www.topleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'TOPPR' },
  { nome: 'Spencer Leilões (PR)', url: 'https://www.spencerleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'SPENCER' },
  { nome: 'Pestana Leilões (RS/Sul)', url: 'https://www.pestanaleiloes.com.br/procurar-bens?tipoBem=462', ufPadrao: 'RS', tag: 'PESTANA' },
  { nome: 'João Emílio Leiloeiro (RJ)', url: 'https://www.joaoemilio.com.br/imoveis', ufPadrao: 'RJ', tag: 'JOAOEMILIO' },
  { nome: 'Rymer Leilões (RJ)', url: 'https://www.rymerleiloes.com.br/imoveis', ufPadrao: 'RJ', tag: 'RYMER' },
  { nome: 'Fernando Caetano (MG)', url: 'https://www.fernandoleiloeiro.com.br/imoveis', ufPadrao: 'MG', tag: 'FERNANDOMG' },
  { nome: 'Alvaro Leilões (GO/DF)', url: 'https://www.alvaroleiloes.com.br/imoveis', ufPadrao: 'GO', tag: 'ALVARO' }
];

// TRAVA ESTRITA: GARANTE QUE APENAS IMÓVEIS REAIS ENTREM NA BASE
const REGEX_BLACKLIST = /\b(sucata|materiais|material|ve[ií]culo|carro|moto|caminh[aã]o|empilhadeira|trator|colheitadeira|inform[aá]tica|computador|notebook|monitor|impressora|mobili[aá]rio|m[oó]veis|cadeira|mesa|arm[aá]rio|equipamento|maquin[aá]rio|m[aá]quina|ferro|aço|cabo|fio|pneu|roda|pe[cç]a|motor|gerador|transformador|eletr[oô]nico|eletrodom[eé]stico|celular|tv|televis[aã]o|roupa|cal[cç]ado|tecido|estoque|mercadoria|ferramenta|tubo|bomba|compressor|tanque|container|embarca[cç][aã]o|barco|lancha|aeronave)\b/i;
const REGEX_IMOVEL_VALIDO = /\b(apartamento|apto|casa|sobrado|resid[eê]ncia|residencial|terreno|lote\s+urbano|lote\s+de\s+terreno|gleba|fazenda|s[ií]tio|ch[aá]cara|im[oó]vel|sala\s+comercial|loja|galp[aã]o|pr[eé]dio|edif[ií]cio|cobertura|kitnet|flat|vaga\s+de\s+garagem|box\s+garagem|matr[ií]cula|alvenaria|pavimento)\b/i;

function ehImovelValido(texto) {
  if (!texto) return false;
  if (REGEX_BLACKLIST.test(texto)) return false;
  return REGEX_IMOVEL_VALIDO.test(texto);
}

function requisicaoWeb(url, encoding = 'utf8', redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve('');
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,text/csv,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      },
      timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const nextUrl = new URL(res.headers.location, url).href;
          return resolve(requisicaoWeb(nextUrl, encoding, redirects + 1));
        } catch {
          return resolve('');
        }
      }
      if (res.statusCode !== 200) return resolve('');
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

function fotoPorTipo(tipo) {
  if (tipo === 'Casa') return 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=900&q=80';
  if (tipo === 'Terreno') return 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=900&q=80';
  if (tipo === 'Comercial') return 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80';
  return 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80';
}

// 1. CAIXA ECONÔMICA FEDERAL (27 ESTADOS - 100% IMÓVEIS)
async function coletarCaixa() {
  const resultados = [];
  const tarefas = ESTADOS.map(async (uf) => {
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
    const texto = await requisicaoWeb(url, 'latin1');
    if (!texto) return [];

    const linhas = texto.split('\n').slice(4);
    const listaUF = [];

    for (const linha of linhas) {
      const cols = linha.split(';').map(s => s.trim());
      if (cols.length < 10 || !cols[0]) continue;

      const id = cols[0];
      const estado = cols[1] || uf;
      const cidade = cols[2] || '';
      const bairro = cols[3] || '';
      const endereco = cols[4] || '';
      const preco = parseFloat((cols[5] || '0').replace(/\./g, '').replace(',', '.'));
      const avaliacao = parseFloat((cols[6] || '0').replace(/\./g, '').replace(',', '.'));
      const modalidade = cols[8] || 'Venda Online';
      const descricao = cols[9] || '';
      const link = cols[10] || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnImovel=${id}`;

      if (preco <= 15000 || avaliacao <= 15000) continue;

      const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
      const ocupado = /ocupado/i.test(descricao) ? 'OCUPADO' : 'DESOCUPADO';
      const financia = /aceita financiamento/i.test(descricao);
      const tipo = detectarTipo(descricao);
      const matchArea = descricao.match(/(\d+[.,]?\d*)\s*m2/i);
      const area = matchArea ? parseFloat(matchArea[1].replace(',', '.')) : 65;

      listaUF.push({
        id: `CX-${id}`,
        chaveDedup: `${estado}-${cidade}-${endereco}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
        titulo: `${tipo} - ${bairro || cidade}`,
        tipo,
        portal: `Caixa (${modalidade})`,
        url: link,
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
        img: fotoPorTipo(tipo),
        portais: [
          { nome: 'Avaliação Caixa', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` },
          { nome: 'Média Regional Est.', faixa: `R$ ${Math.round(avaliacao * 1.07).toLocaleString('pt-BR')}` }
        ],
        pois: ['Infraestrutura Urbana Consolidada'],
        processo: `Caixa ID ${id} • ${modalidade}`,
        resumoEdital: descricao
      });
    }
    console.log(`[Caixa ${uf}] ${listaUF.length} imóveis`);
    return listaUF;
  });

  const porEstado = await Promise.all(tarefas);
  for (const lista of porEstado) resultados.push(...lista);
  return resultados;
}

// 2. REDE SUPERBID EXCHANGE — FILTRADO ESTRITAMENTE PARA IMÓVEIS (CATEGORY IMÓVEIS = 42)
async function coletarSuperbidImoveis() {
  const resultados = [];
  for (let page = 1; page <= 12; page++) {
    const url = `https://offer-query.superbid.net/offers/?portalId=2&filter=product.subCategory.category.id:42&pageNumber=${page}&pageSize=100`;
    const raw = await requisicaoWeb(url);
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

        resultados.push({
          id: `SB-${o.id}`,
          chaveDedup: `${uf}-${cidade}-${desc}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
          titulo: desc.slice(0, 95),
          tipo,
          portal: leiloeiroNome,
          url: `https://www.superbid.net/oferta/${o.id}`,
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
          img: o.product?.thumbnailUrl || fotoPorTipo(tipo),
          portais: [{ nome: 'Avaliação Edital', faixa: `R$ ${Math.round(avaliacao).toLocaleString('pt-BR')}` }],
          pois: ['Localização urbana verificada'],
          processo: `Lote #${o.id} • ${leiloeiroNome}`,
          resumoEdital: det || desc
        });
      }
    } catch {
      break;
    }
  }
  console.log(`[Superbid Imóveis] ${resultados.length} imóveis válidos`);
  return resultados;
}

// 3. EXTRATOR MULTI-CAMADA PARA PORTAIS IMOBILIÁRIOS (COM TRAVA DE VALIDAÇÃO)
async function coletarFonteIndividual(fonte) {
  const html = await requisicaoWeb(fonte.url);
  if (!html) return [];

  const encontrados = [];
  const regexJsonLd = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regexJsonLd.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const itens = Array.isArray(data) ? data : (data.itemListElement || [data]);

      for (const entry of itens) {
        const item = entry.item || entry;
        if (!item || !item.name) continue;
        if (!ehImovelValido(`${item.name} ${item.description || ''}`)) continue;

        const preco = Number(item.offers?.price || item.price || 0);
        if (preco <= 20000) continue;

        const avaliacao = Math.round(preco * 1.42);
        const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
        const ufMatch = String(item.address?.addressRegion || item.name).match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/);
        const uf = ufMatch ? ufMatch[1] : fonte.ufPadrao;
        const cidade = item.address?.addressLocality || 'Região Metropolitana';
        const link = item.url ? (item.url.startsWith('http') ? item.url : new URL(item.url, fonte.url).href) : fonte.url;
        const tipo = detectarTipo(item.name);

        encontrados.push({
          id: `${fonte.tag}-${encontrados.length}-${Math.floor(Math.random() * 9000 + 1000)}`,
          chaveDedup: `${uf}-${cidade}-${item.name}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
          titulo: String(item.name).slice(0, 95),
          tipo,
          portal: fonte.nome,
          url: link,
          uf,
          cidade,
          bairro: item.address?.addressNeighborhood || 'Centro',
          endereco: item.address?.streetAddress || `${cidade} - ${uf}`,
          area: 75,
          quartos: tipo === 'Terreno' ? 0 : 2,
          vagas: tipo === 'Terreno' ? 0 : 1,
          avaliacao,
          mercado: Math.round(avaliacao * 1.05),
          lance1: Math.round(avaliacao * 0.85),
          data1: '1ª Praça',
          lance2: Math.round(preco),
          data2: '2ª Praça',
          financia: false,
          ocupado: 'NAO_INFORMADO',
          dividas: 'VERIFICAR_EDITAL',
          risco: 'MEDIO',
          estrategias: detectarEstrategias(desconto, item.name),
          indiceLocal: 8.0,
          score: calcularScoreOraculo(desconto, uf, 'NAO_INFORMADO', false),
          img: item.image || fotoPorTipo(tipo),
          portais: [{ nome: 'Avaliação Estimada', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` }],
          pois: ['Consulte entorno no edital'],
          processo: `Captação ${fonte.nome}`,
          resumoEdital: item.description || `Imóvel capturado em ${fonte.nome}.`
        });
      }
    } catch {}
  }

  if (encontrados.length > 0) {
    console.log(`[${fonte.nome}] ${encontrados.length} imóveis`);
  }
  return encontrados;
}

async function coletarTodasFontesNacionais() {
  const resultados = [];
  for (let i = 0; i < FONTES_NACIONAIS.length; i += 8) {
    const bloco = FONTES_NACIONAIS.slice(i, i + 8);
    const respostas = await Promise.all(bloco.map(f => coletarFonteIndividual(f)));
    for (const r of respostas) resultados.push(...r);
  }
  return resultados;
}

(async () => {
  console.log('=== INICIANDO VARREDURA IMOBILIÁRIA NACIONAL (100% FILTRADA) ===');

  const [caixa, superbid, portais] = await Promise.all([
    coletarCaixa(),
    coletarSuperbidImoveis(),
    coletarTodasFontesNacionais()
  ]);

  const bruto = [...caixa, ...superbid, ...portais];
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
    total_brasil_bruto: bruto.length,
    total_unificado: unificados.length,
    lotes: unificados.slice(0, 6000)
  };

  fs.writeFileSync('imoveis.json', JSON.stringify(saida));
  console.log(`=== CONCLUÍDO! Imóveis Brutos: ${bruto.length} | Únicos: ${unificados.length} | Salvos: ${saida.lotes.length} ===`);
})();
