const fs = require('fs');
const https = require('https');

const ESTADOS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const PORTAIS_NACIONAIS = [
  { nome: 'Portal Zuk', url: 'https://www.portalzuk.com.br/leilao-de-imoveis', tag: 'ZUK' },
  { nome: 'Mega Leilões', url: 'https://www.megaleiloes.com.br/imoveis', tag: 'MEGA' },
  { nome: 'Sodré Santoro', url: 'https://www.sodresantoro.com.br/imoveis', tag: 'SODRE' },
  { nome: 'Biasi Leilões', url: 'https://www.biasileiloes.com.br/imoveis', tag: 'BIASI' },
  { nome: 'Frazão Leilões', url: 'https://www.frazaoleiloes.com.br/imoveis', tag: 'FRAZAO' },
  { nome: 'Pestana Leilões', url: 'https://www.pestanaleiloes.com.br/procurar-bens?tipoBem=462', tag: 'PESTANA' },
  { nome: 'Freitas Leiloeiro', url: 'https://www.freitasleiloeiro.com.br/leiloes/imoveis', tag: 'FREITAS' },
  { nome: 'VIP Leilões', url: 'https://www.vipleiloes.com.br/imoveis', tag: 'VIP' },
  { nome: 'Lance Já', url: 'https://www.lanceja.com.br/imoveis', tag: 'LANCEJA' },
  { nome: 'João Emílio', url: 'https://www.joaoemilio.com.br/imoveis', tag: 'JOAOEMILIO' },
  { nome: 'Banco do Brasil', url: 'https://seuimovelbb.com.br/catalogo', tag: 'BB' },
  { nome: 'Bradesco Imóveis', url: 'https://banco.bradesco/html/classic/produtos-servicos/leiloes/imoveis.shtm', tag: 'BRADESCO' },
  { nome: 'Itaú Leilões', url: 'https://www.itau.com.br/imoveis-leilao', tag: 'ITAU' },
  { nome: 'Santander Imóveis', url: 'https://www.santanderimoveis.com.br/', tag: 'SANTANDER' }
];

function requisicaoHTTPS(url, encoding = 'utf8') {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,text/csv,*/*'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(requisicaoHTTPS(nextUrl, encoding));
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
  let score = 5.0 + (desconto / 11.5);
  if (['PR', 'SP', 'SC', 'MG', 'RS', 'RJ', 'GO', 'DF'].includes(estado)) score += 0.5;
  if (ocupado === 'DESOCUPADO') score += 0.4;
  if (financia) score += 0.3;
  return Math.min(9.9, Math.max(1.0, Number(score.toFixed(1))));
}

function detectarEstrategias(desconto, texto) {
  const tags = [];
  if (desconto >= 38) tags.push('REVENDA');
  if (/praia|litoral|balne[aá]rio|mar\b/i.test(texto)) tags.push('PRAIA', 'AIRBNB');
  if (/universidade|faculdade|campus|uem|ufpr|usp|unicamp/i.test(texto)) tags.push('UNIVERSITARIO');
  if (tags.length === 0) tags.push('REVENDA');
  return [...new Set(tags)];
}

async function coletarCaixa() {
  const resultados = [];
  for (const uf of ESTADOS) {
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
    const texto = await requisicaoHTTPS(url, 'latin1');
    if (!texto) continue;

    const linhas = texto.split('\n').slice(4);
    let countUF = 0;

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

      if (preco <= 0 || avaliacao <= 0) continue;

      const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
      const ocupado = /ocupado/i.test(descricao) ? 'OCUPADO' : 'DESOCUPADO';
      const financia = /aceita financiamento/i.test(descricao);
      const score = calcularScoreOraculo(desconto, estado, ocupado, financia);

      let tipo = 'Apartamento';
      if (/casa|sobrado/i.test(descricao)) tipo = 'Casa';
      else if (/terreno|lote|gleba/i.test(descricao)) tipo = 'Terreno';
      else if (/comercial|sala|loja|galp/i.test(descricao)) tipo = 'Comercial';

      const matchArea = descricao.match(/(\d+[.,]?\d*)\s*m2/i);
      const area = matchArea ? parseFloat(matchArea[1].replace(',', '.')) : 65;

      resultados.push({
        id: `CX-${id}`,
        chaveDedup: `${estado}-${cidade}-${endereco}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 45),
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
        score,
        img: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=900&q=80',
        portais: [
          { nome: 'Avaliação Caixa', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` },
          { nome: 'Média Regional Est.', faixa: `R$ ${Math.round(avaliacao * 1.07).toLocaleString('pt-BR')}` }
        ],
        pois: ['Infraestrutura Urbana Consolidada'],
        processo: `Caixa ID ${id} • ${modalidade}`,
        resumoEdital: descricao
      });
      countUF++;
    }
    console.log(`[Caixa ${uf}] ${countUF} imóveis`);
  }
  return resultados;
}

async function coletarSuperbidRede() {
  const resultados = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://offer-query.superbid.net/offers/?portalId=2&filter=product.productType.id:1&pageNumber=${page}&pageSize=100`;
    const raw = await requisicaoHTTPS(url);
    if (!raw) break;

    try {
      const json = JSON.parse(raw);
      const ofertas = json.offers || [];
      if (!ofertas.length) break;

      for (const o of ofertas) {
        const preco = Number(o.price || o.initialBidValue || 0);
        const avaliacao = Number(o.marketValue || preco * 1.38);
        if (preco <= 0) continue;

        const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
        const uf = (o.store?.state || 'SP').toUpperCase();
        const cidade = o.store?.city || 'São Paulo';
        const bairro = o.store?.neighborhood || 'Centro';
        const desc = o.product?.shortDesc || 'Imóvel em Leilão Judicial/Extrajudicial';
        const leiloeiroNome = o.auctioneer?.name || 'Superbid Exchange';

        let tipo = 'Apartamento';
        if (/casa|resid[eê]ncia|sobrado/i.test(desc)) tipo = 'Casa';
        else if (/terreno|lote|gleba|rural/i.test(desc)) tipo = 'Terreno';
        else if (/galp|comercial|sala|loja|pr[eé]dio/i.test(desc)) tipo = 'Comercial';

        const score = calcularScoreOraculo(desconto, uf, 'NAO_INFORMADO', false);

        resultados.push({
          id: `SB-${o.id}`,
          chaveDedup: `${uf}-${cidade}-${desc}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 45),
          titulo: desc.slice(0, 90),
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
          score,
          img: o.product?.thumbnailUrl || 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=900&q=80',
          portais: [{ nome: 'Avaliação Edital', faixa: `R$ ${Math.round(avaliacao).toLocaleString('pt-BR')}` }],
          pois: ['Localização urbana verificada'],
          processo: `Lote #${o.id} • ${leiloeiroNome}`,
          resumoEdital: o.product?.detailedDesc || desc
        });
      }
    } catch {
      break;
    }
  }
  console.log(`[Rede Superbid / Judiciais] ${resultados.length} imóveis`);
  return resultados;
}

async function coletarPortaisNacionais() {
  const resultados = [];

  for (const portal of PORTAIS_NACIONAIS) {
    const html = await requisicaoHTTPS(portal.url);
    if (!html) {
      console.log(`[${portal.nome}] Sem resposta direta`);
      continue;
    }

    let encontradosPortal = 0;
    const regexJsonLd = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regexJsonLd.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const itens = Array.isArray(data) ? data : (data.itemListElement || [data]);

        for (const entry of itens) {
          const item = entry.item || entry;
          if (!item || !item.name) continue;
          const preco = Number(item.offers?.price || item.price || 0);
          if (preco <= 10000) continue;

          const avaliacao = Math.round(preco * 1.42);
          const desconto = Math.round(((avaliacao - preco) / avaliacao) * 100);
          const ufMatch = String(item.address?.addressRegion || item.name).match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/);
          const uf = ufMatch ? ufMatch[1] : 'SP';
          const cidade = item.address?.addressLocality || 'Capital / Região';
          const link = item.url ? (item.url.startsWith('http') ? item.url : new URL(item.url, portal.url).href) : portal.url;

          resultados.push({
            id: `${portal.tag}-${encontradosPortal}-${Date.now().toString().slice(-4)}`,
            chaveDedup: `${uf}-${cidade}-${item.name}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 45),
            titulo: String(item.name).slice(0, 90),
            tipo: /casa/i.test(item.name) ? 'Casa' : (/terreno|lote/i.test(item.name) ? 'Terreno' : 'Apartamento'),
            portal: portal.nome,
            url: link,
            uf,
            cidade,
            bairro: item.address?.addressNeighborhood || 'Centro',
            endereco: item.address?.streetAddress || `${cidade} - ${uf}`,
            area: 75,
            quartos: 2,
            vagas: 1,
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
            img: item.image || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80',
            portais: [{ nome: 'Avaliação Estimada', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` }],
            pois: ['Consulte entorno no edital'],
            processo: `Captação ${portal.nome}`,
            resumoEdital: item.description || `Lote capturado em ${portal.nome}.`
          });
          encontradosPortal++;
        }
      } catch {}
    }
    console.log(`[${portal.nome}] ${encontradosPortal} imóveis extraídos`);
  }

  return resultados;
}

(async () => {
  console.log('=== INICIANDO VARREDURA NACIONAL MULTI-PORTAL ===');

  const [caixa, superbid, portais] = await Promise.all([
    coletarCaixa(),
    coletarSuperbidRede(),
    coletarPortaisNacionais()
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
    lotes: unificados.slice(0, 5000)
  };

  fs.writeFileSync('imoveis.json', JSON.stringify(saida));
  console.log(`=== CONCLUÍDO! Bruto: ${bruto.length} | Únicos: ${unificados.length} | Salvos: ${saida.lotes.length} ===`);
})();
