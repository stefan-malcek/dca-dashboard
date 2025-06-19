let stockData = [];

async function fetchStockDataFromCSV() {
    const url = 'https://corsproxy.io/?https://docs.google.com/spreadsheets/d/e/2PACX-1vR_0eZYqS2ElxHR6bMIOd5gsRjL1mJn-YYECbT-yHKcXx5OF9dKBON-mMJvPq9Z0FQFhXNgOXu-Z8FP/pub?gid=711113917&single=true&output=csv';
    const res = await fetch(url);
    const text = await res.text();

    const rows = text.trim().split('\n').slice(1); // skip header
    const dataBySymbol = {};

    for (let row of rows) {
        // Clean up any trailing \r and parse CSV correctly
        row = row.trim().replace(/\r$/, '');

        // Handle quoted decimal values (replace comma with dot inside quotes)
        const fields = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => {
            return cell.replace(/^"|"$/g, '').replace(',', '.');
        });

        const [symbol, dateStr, priceStr, highStr] = fields;
        const date = new Date(dateStr);
        const price = parseFloat(priceStr);
        const high = parseFloat(highStr);

        if (!dataBySymbol[symbol]) dataBySymbol[symbol] = [];
        if (!isNaN(price) && !isNaN(high)) {
            dataBySymbol[symbol].push({ date, price, high });
        }
    }

    return Object.entries(dataBySymbol).map(([symbol, prices]) => {
        const currentPrice = prices[prices.length - 1].price;
        const high52 = Math.max(...prices.map(d => d.high));
        return { symbol, prices, currentPrice, high52 };
    });
}

async function loadOrCreateStock(symbol) {
    symbol = symbol.toUpperCase();
    const existing = stockData.find(s => s.symbol === symbol);
    if (existing) return existing;
    const newStock = await fetchStockData(symbol);
    stockData.push(newStock);
    populateSummary(stockData, newStock.symbol);
    return newStock;
}

function populateSummary(data, activeSymbol) {
    const container = d3.select('#stock-summary').html('');
    const percent = parseFloat(document.getElementById('percent-input')?.value || '20');
    container.selectAll('button')
        .data(data)
        .enter()
        .append('button')
        .attr('class', d => `px-3 py-1 m-1 text-sm border rounded-md whitespace-nowrap ${d.symbol === activeSymbol ? 'bg-indigo-600 text-white' : ((1 - d.currentPrice / d.high52) * 100).toFixed(1) > percent ? 'bg-green-200 hover:bg-green-300' : 'bg-gray-200 hover:bg-gray-300'}`)
        .text(d => `${d.symbol}: ${((1 - d.currentPrice / d.high52) * 100).toFixed(1)}% below`)
        .on('click', (e, d) => {
            updateChart(d.symbol);
        });
}

document.getElementById('add-stock-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-stock');
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    try {
        const stock = await loadOrCreateStock(symbol);
        input.value = '';
        updateChart(stock.symbol);
    } catch (e) {
        alert(`Could not add stock "${symbol}".`);
    }
});

document.getElementById('new-stock').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('add-stock-btn').click();
});

document.getElementById('percent-input').addEventListener('input', () => {
    const active = d3.select('#stock-summary button.bg-indigo-600').text().split(':')[0];
    if (active) updateChart(active);
});

let selectedPoint = null;

function updateChart(symbol, brushedRange = null) {
    const stock = stockData.find(s => s.symbol === symbol);
    if (!stock) return;

    populateSummary(stockData, symbol);

    const prices = stock.prices;
    const maxPrice = d3.max(prices, d => d.price);
    const minPrice = d3.min(prices, d => d.price);
    const percent = parseFloat(document.getElementById('percent-input')?.value || '20');
    const supportLevel = !isNaN(percent) ? maxPrice * (1 - percent / 100) : null;
    const yMin = !isNaN(percent) ? Math.min(minPrice * 0.95, supportLevel) : minPrice * 0.95;
    const yMax = maxPrice * 1.05;

    d3.select('#chart').selectAll('*').remove();

    const width = document.getElementById('chart').clientWidth;
    const height = 400;
    const margin = { top: 20, right: 30, bottom: 30, left: 50 };

    const svg = d3.select('#chart')
        .append('svg')
        .attr('width', '100%')
        .attr('height', height + 100)
        .attr('viewBox', `0 0 ${width} ${height + 100}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const x = d3.scaleTime()
        .domain(brushedRange || d3.extent(prices, d => d.date))
        .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
        .domain([yMin, yMax])
        .nice()
        .range([height - margin.bottom, margin.top]);

    const mainChart = svg.append('g');

    const tooltip = d3.select('#chart')
        .append('div')
        .style('position', 'absolute')
        .style('background', 'white')
        .style('border', '1px solid #ccc')
        .style('padding', '5px 10px')
        .style('border-radius', '5px')
        .style('pointer-events', 'none')
        .style('font-size', '12px')
        .style('display', 'none');

    mainChart.append('line')
        .attr('x1', margin.left)
        .attr('x2', width - margin.right)
        .attr('y1', y(maxPrice))
        .attr('y2', y(maxPrice))
        .attr('stroke', 'red')
        .attr('stroke-dasharray', '5,5');

    mainChart.append('text')
        .attr('x', width - margin.right)
        .attr('y', y(maxPrice) - 5)
        .attr('text-anchor', 'end')
        .attr('fill', 'red')
        .text(`52W High: $${maxPrice.toFixed(2)}`);

    if (!isNaN(percent)) {
        mainChart.append('line')
            .attr('x1', margin.left)
            .attr('x2', width - margin.right)
            .attr('y1', y(supportLevel))
            .attr('y2', y(supportLevel))
            .attr('stroke', 'green')
            .attr('stroke-dasharray', '5,5');

        mainChart.append('text')
            .attr('x', width - margin.right)
            .attr('y', y(supportLevel) - 5)
            .attr('text-anchor', 'end')
            .attr('fill', 'green')
            .text(`${percent}% Below 52W High: $${supportLevel.toFixed(2)}`);
    }

    const line = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.price));

    mainChart.append('path')
        .datum(prices)
        .attr('fill', 'none')
        .attr('stroke', '#4F46E5')
        .attr('stroke-width', 2)
        .attr('d', line)
        .attr('stroke-dasharray', function () {
            const totalLength = this.getTotalLength();
            return `${totalLength} ${totalLength}`;
        })
        .attr('stroke-dashoffset', function () {
            return this.getTotalLength();
        })
        .transition()
        .duration(1000)
        .attr('stroke-dashoffset', 0);

    svg.on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const date = x.invert(mx);
        const bisectDate = d3.bisector(d => d.date).left;
        const i = bisectDate(prices, date);
        const d0 = prices[i - 1];
        const d1 = prices[i];
        const d = !d0 || (d1 && (date - d0.date > d1.date - date)) ? d1 : d0;
        if (!d) return;

        mainChart.selectAll('.highlighted').remove();
        mainChart.append('circle')
            .attr('class', 'highlighted')
            .attr('cx', x(d.date))
            .attr('cy', y(d.price))
            .attr('r', 6)
            .attr('fill', '#4F46E5')
            .attr('stroke', '#333');

        const percentDrop = ((1 - d.price / stock.high52) * 100).toFixed(2);
        tooltip.html(`<strong>${d.date.toISOString().split('T')[0]}</strong><br/>Price: $${d.price.toFixed(2)}<br/>↓ ${percentDrop}% from 52W High`)
            .style('left', `${x(d.date) - 150}px`)
            .style('top', `${y(d.price) - 60}px`)
            .style('display', 'block');
    })
        .on('mouseleave', function () {
            tooltip.style('display', 'none');
            mainChart.selectAll('.highlighted').remove();
        });

    mainChart.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x));

    mainChart.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));

    if (!window.timeline) {
        window.timeline = new Timeline('#timeline', (range) => updateChart(symbol, range));
    }
    window.timeline.setData(prices);
}

class Timeline {
    constructor(parentElement, onBrush) {
        this.parentElement = parentElement;
        this.onBrush = onBrush;
        this.initVis();
    }

    initVis() {
        this.margin = { top: 0, right: 100, bottom: 30, left: 80 };
        this.width = 800 - this.margin.left - this.margin.right;
        this.height = 130 - this.margin.top - this.margin.bottom;

        this.svg = d3.select(this.parentElement).append("svg")
            .attr("width", this.width + this.margin.left + this.margin.right)
            .attr("height", this.height + this.margin.top + this.margin.bottom);

        this.g = this.svg.append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

        this.x = d3.scaleTime().range([0, this.width]);
        this.y = d3.scaleLinear().range([this.height, 0]);

        this.xAxisCall = d3.axisBottom().ticks(4);
        this.xAxis = this.g.append("g")
            .attr("class", "x axis")
            .attr("transform", `translate(0,${this.height})`);

        this.areaPath = this.g.append("path").attr("fill", "#ccc");

        this.brush = d3.brushX()
            .extent([[0, 0], [this.width, this.height]])
            .on("brush end", ({ selection }) => {
                if (selection && this.data) {
                    const [x0, x1] = selection;
                    const brushedRange = [this.x.invert(x0), this.x.invert(x1)];
                    this.onBrush(brushedRange);
                }
            });

        this.brushComponent = this.g.append("g")
            .attr("class", "brush")
            .call(this.brush);
    }

    setData(data, yVariable = "price") {
        this.data = data;
        this.yVariable = yVariable;

        this.x.domain(d3.extent(data, d => d.date));
        this.y.domain([0, d3.max(data, d => d[yVariable])]);

        const area = d3.area()
            .x(d => this.x(d.date))
            .y0(this.height)
            .y1(d => this.y(d[yVariable]));

        this.areaPath.datum(data).attr("d", area);
        this.xAxis.call(this.xAxisCall.scale(this.x));
    }
}


async function fetchStockData(symbol) {
    const url = `https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
    const json = await res.json();

    if (!json.chart || json.chart.error || !json.chart.result) {
        throw new Error(`Yahoo Finance error for ${symbol}`);
    }

    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    const parsed = timestamps.map((t, i) => {
        const date = new Date(t * 1000);
        const price = quotes.close[i];
        const high = quotes.high[i];
        return { date, price, high };
    }).filter(d => d.price && d.high);

    const currentPrice = parsed[parsed.length - 1].price;
    const high52 = Math.max(...parsed.map(d => d.high));

    return { symbol, prices: parsed, currentPrice, high52 };
}


async function loadInitialData() {
    stockData = await fetchStockDataFromCSV();
    populateSummary(stockData, stockData[0].symbol);
    updateChart(stockData[0].symbol);
}

loadInitialData();
