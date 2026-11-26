const fs = require('fs');
const https = require('https');

// Estados do Brasil para varredura nacional
const ESTADOS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

function baixarCSV(uf) {
  return new Promise((resolve) => {
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) return resolve([]);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(chunks).toString('latin1');
        const linhas = texto.split('\n').slice(4); // Pula cabeçalho oficial
        const lotes = [];

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
          // Calcula Score Oráculo (0 a 10) baseado no desconto e liquidez
          let score = 5.0 + (desconto / 12);
          if (['PR', 'SP', 'SC', 'MG', 'RS', 'RJ'].includes(estado)) score += 0.6;
          score = Math.min(9.9, Math.max(1.0, Number(score.toFixed(1))));

          // Detecta tipo e metragem pela descrição
          let tipo = 'Apartamento';
          if (/casa/i.test(descricao)) tipo = 'Casa';
          else if (/terreno|lote/i.test(descricao)) tipo = 'Terreno';
          else if (/comercial|sala|loja|galp/i.test(descricao)) tipo = 'Comercial';

          const matchArea = descricao.match(/(\d+[.,]?\d*)\s*m2/i);
          const area = matchArea ? parseFloat(matchArea[1].replace(',', '.')) : 65;

          lotes.push({
            id: `CX-${id}`,
            titulo: `${tipo} - ${bairro || cidade}`,
            tipo,
            portal: `Caixa Econômica (${modalidade})`,
            url: link,
            uf: estado,
            cidade,
            bairro: bairro || 'Centro',
            endereco,
            area,
            quartos: tipo === 'Terreno' ? 0 : 2,
            vagas: tipo === 'Terreno' ? 0 : 1,
            avaliacao,
            mercado: Math.round(avaliacao * 1.06), // Estimativa média regional
            lance1: avaliacao,
            data1: 'Em andamento',
            lance2: preco,
            data2: 'Imediato / Praça Única',
            financia: /aceita financiamento/i.test(descricao),
            ocupado: /ocupado/i.test(descricao) ? 'OCUPADO' : 'DESOCUPADO',
            dividas: 'VENDEDOR_BANCO',
            risco: /ocupado/i.test(descricao) ? 'MEDIO' : 'BAIXO',
            estrategias: desconto >= 40 ? ['REVENDA'] : ['ALUGUEL'],
            indiceLocal: 8.0,
            score,
            img: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=900&q=80',
            portais: [
              { nome: 'Avaliação Oficial', faixa: `R$ ${avaliacao.toLocaleString('pt-BR')}` },
              { nome: 'Média Regional Est.', faixa: `R$ ${Math.round(avaliacao * 1.06).toLocaleString('pt-BR')}` }
            ],
            pois: ['Infraestrutura Urbana Consolidada'],
            processo: `Imóvel Caixa ID ${id} • Modalidade: ${modalidade}`,
            resumoEdital: descricao
          });
        }
        resolve(lotes);
      });
    }).on('error', () => resolve([]));
  });
}

(async () => {
  console.log('Iniciando varredura nacional...');
  let todos = [];
  for (const uf of ESTADOS) {
    const lista = await baixarCSV(uf);
    console.log(`${uf}: ${lista.length} imóveis capturados`);
    todos = todos.concat(lista);
  }

  // Ordena pelos maiores Scores e salva os 3.000 melhores para carregamento instantâneo
  todos.sort((a, b) => b.score - a.score);
  const saida = {
    atualizado_em: new Date().toISOString(),
    total_brasil: todos.length,
    lotes: todos.slice(0, 3000)
  };

  fs.writeFileSync('imoveis.json', JSON.stringify(saida));
  console.log(`Concluído! Total no Brasil: ${todos.length} | Salvos no JSON: ${saida.lotes.length}`);
})();
