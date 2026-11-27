const fs = require('fs');
const https = require('https');
const http = require('http');

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

const ESTADOS = [
  'PR','SP','SC','MG','RS','RJ','GO','DF','BA','PE','CE','ES','MT','MS',
  'PA','PB','RN','AL','SE','AM','MA','PI','RO','TO','AC','AP','RR'
];

const FONTES_NACIONAIS = [
  { nome: 'Banco do Brasil', url: 'https://seuimovelbb.com.br/catalogo', ufPadrao: 'DF', tag: 'BB' },
  { nome: 'Portal Zuk', url: 'https://www.portalzuk.com.br/leilao-de-imoveis', ufPadrao: 'SP', tag: 'ZUK' },
  { nome: 'Mega Leilões', url: 'https://www.megaleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'MEGA' },
  { nome: 'Sodré Santoro', url: 'https://www.sodresantoro.com.br/imoveis', ufPadrao: 'SP', tag: 'SODRE' },
  { nome: 'Biasi Leilões', url: 'https://www.biasileiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'BIASI' },
  { nome: 'Frazão Leilões', url: 'https://www.frazaoleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'FRAZAO' },
  { nome: 'Freitas Leiloeiro', url: 'https://www.freitasleiloeiro.com.br/leiloes/imoveis', ufPadrao: 'SP', tag: 'FREITAS' },
  { nome: 'VIP Leilões', url: 'https://www.vipleiloes.com.br/imoveis', ufPadrao: 'SP', tag: 'VIP' },
  { nome: 'Lance Judicial', url: 'https://www.lancejudicial.com.br/imoveis', ufPadrao: 'SP', tag: 'LANCEJUD' },
  { nome: 'Kronberg Leilões (PR)', url: 'https://www.kronbergleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'KRONBERG' },
  { nome: 'Nakakogue Leilões (PR)', url: 'https://www.nakakogueleiloes.com.br/imoveis', ufPadrao: 'PR', tag: 'NAKAKOGUE' },
  { nome: 'Pestana Leilões (Sul)', url: 'https://www.pestanaleiloes.com.br/procurar-bens?tipoBem=462', ufPadrao: 'RS', tag: 'PESTANA' },
  { nome: 'João Emílio (RJ)', url: 'https://www.joaoemilio.com.br/imoveis', ufPadrao: 'RJ', tag: 'JOAOEMILIO' },
  { nome: 'Fernando Caetano (MG)', url: 'https://www.fernandoleiloeiro.com.br/imoveis', ufPadrao: 'MG', tag: 'FERNANDOMG' },
  { nome: 'Alvaro Leilões (GO/DF)', url: 'https://www.alvaroleiloes.com.br/imoveis', ufPadrao: 'GO', tag: 'ALVARO' }
];

const REGEX_BLACKLIST = /\b(sucata|materiais|material|ve[ií]culo|carro|moto|caminh[aã]o|empilhadeira|trator|colheitadeira|inform[aá]tica|computador|notebook|monitor|impressora|mobili[aá]rio|m[oó]veis|cadeira|mesa|arm[aá]rio|equipamento|maquin[aá]rio|m[aá]quina|ferro|aço|cabo|fio|pneu|roda|pe[cç]a|motor|gerador|transformador|eletr[oô]nico|eletrodom[eé]stico|celular|tv|televis[aã]o|roupa|cal[cç]ado|tecido|estoque|mercadoria|ferramenta|tubo|bomba|compressor|tanque|container|embarca[cç][aã]o|barco|lancha|aeronave)\b/i;
const REGEX_IMOVEL_VALIDO = /\b(apartamento|apto|casa|sobrado|resid[eê]ncia|residencial|terreno|lote\s+urbano|lote\s+de\s+terreno|gleba|fazenda|s[ií]tio|ch[aá]cara|im[oó]vel|sala\s+comercial|loja|galp[aã]o|pr[eé]dio|edif[ií]cio|cobertura|kitnet|flat|vaga\s+de\s+garagem|box\s+garagem|matr[ií]cula|alvenaria|pavimento)\b/i;

function ehImovelValido(texto) {
  if (!texto) return false;
  if (REGEX_BLACKLIST.test(texto)) return false;
  return REGEX_IMOVEL_VALIDO.test(texto);
}

function requisicaoComProxyBR(targetUrl, encoding = 'utf8', usarProxy = true) {
  return new Promise((resolve) => {
    let finalUrl = targetUrl;
    if (usarProxy && SCRAPER_API_KEY) {
      finalUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&country_code=br&url=${encodeURIComponent(targetUrl)}`;
    }
    const lib = finalUrl.startsWith('https') ? https : http;
    const req = lib.get(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,text/csv,*/*'
      },
      timeout: 35000
    }, (res) => {
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

async function coletarCaixa() {
  const resultados = [];
  for (let i = 0; i < ESTADOS.length; i += 5) {
    const bloco = ESTADOS.slice(i, i + 5);
    const listas = await Promise.all(bloco.map(async (uf) => {
      const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
      const texto = await requisicaoComProxyBR(url, 'latin1', true);
      if (!texto || !texto.includes(';')) return [];

      const linhas = texto.split('\n').slice(4);
      const listaUF = [];

      for (const linha of linhas) {
        const cols = linha.split(';').map(s => s.trim());
        if (cols.length < 10 || !cols[0]) continue;

        // ID com 13 dígitos completos (zeros à esquerda) para evitar 404 na Caixa
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

        // URL oficial corrigida da Caixa com 13 dígitos
        const linkOficial = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnImovel=${id13}`;
        // URL oficial da foto principal do imóvel na Caixa
        const fotoOficialCaixa = `https://venda-imoveis.caixa.gov.br/fotos/F${id13}21.jpg`;

        if (preco <= 15000 || avaliacao <= 15000) continue;

        const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
        const ocupado = /ocupado/i.test(descricao) ? 'OCUPADO' : 'DESOCUPADO';
        const financia = /aceita financiamento/i.test(descricao);
        const tipo = detectarTipo(descricao);
        const matchArea = descricao.match(/(\d+[.,]?\d*)\s*m2/i);
        const area = matchArea ? parseFloat(matchArea[1].replace(',', '.')) : 65;

        listaUF.push({
          id: `CX-${id13}`,
          chaveDedup: `${estado}-${cidade}-${endereco}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
          titulo: `${tipo} - ${bairro || cidade}`,
          tipo,
          portal: `Caixa (${modalidade})`,
          url: linkOficial,
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
          img: fotoOficialCaixa,
          portais: [
            { nome: 'Avaliação Caixa', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` },
            { nome: 'Média Regional Est.', faixa: `R$ ${Math.round(avaliacao * 1.07).toLocaleString('pt-BR')}` }
          ],
          pois: ['Infraestrutura Urbana Consolidada'],
          processo: `Caixa ID ${id13} • ${modalidade}`,
          resumoEdital: descricao
        });
      }
      console.log(`[Caixa ${uf}] ${listaUF.length} imóveis`);
      return listaUF;
    }));
    for (const l of listas) resultados.push(...l);
  }
  return resultados;
}

async function coletarSuperbidImoveis() {
  const resultados = [];
  for (let page = 1; page <= 8; page++) {
    const url = `https://offer-query.superbid.net/offers/?portalId=2&filter=product.subCategory.category.id:42&pageNumber=${page}&pageSize=100`;
    const raw = await requisicaoComProxyBR(url, 'utf8', false);
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
          chaveDedup: `${uf}-${cidade}-${desc}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48),
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
  }
  console.log(`[Superbid Imóveis] ${resultados.length} imóveis`);
  return resultados;
}

async function coletarPortaisBR() {
  const resultados = [];
  for (let i = 0; i < FONTES_NACIONAIS.length; i += 5) {
    const bloco = FONTES_NACIONAIS.slice(i, i + 5);
    const listas = await Promise.all(bloco.map(async (fonte) => {
      const html = await requisicaoComProxyBR(fonte.url, 'utf8', true);
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
              img: item.image || '',
              portais: [{ nome: 'Avaliação Estimada', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` }],
              pois: ['Consulte entorno no edital'],
              processo: `Captação ${fonte.nome}`,
              resumoEdital: item.description || `Imóvel capturado em ${fonte.nome}.`
            });
          }
        } catch {}
      }
      return encontrados;
    }));
    for (const l of listas) resultados.push(...l);
  }
  return resultados;
}

(async () => {
  console.log(`=== INICIANDO VARREDURA NACIONAL (Proxy BR: ${SCRAPER_API_KEY ? 'ATIVO' : 'INATIVO'}) ===`);

  const caixa = await coletarCaixa();
  const superbid = await coletarSuperbidImoveis();
  const portais = await coletarPortaisBR();

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
  console.log(`=== CONCLUÍDO! Bruto: ${bruto.length} | Únicos: ${unificados.length} | Salvos: ${saida.lotes.length} ===`);
})();
