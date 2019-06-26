const express = require("express");
const expressFileupload = require('express-fileupload');
const Papa = require('papaparse');
const qrcode = require('qrcode');
const { createCanvas, Image } = require('canvas');
const fs = require('fs').promises;
const _fs = require('fs');
const { zip } = require('zip-a-folder');
const rimraf = require('rimraf');

const app = express();
const PORT = process.env.PORT || 8080;
const LOGO_SIZE = process.env.LOGO_SIZE || 80
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(expressFileupload());

const jobs = {};

(async () => {
	try {
		await fs.mkdir('jobs')
	} catch(e) { }
	await rimraf('jobs/*', e=>{});
})();

app.post('/jobs', (req, res) => {
	if (!req.files) return;
	const { data, logo } = req.files;
	const fgColor = req.body.foreground || "#000000";
	const bgColor = req.body.background || "#ffffff";
	const id = Date.now();
	jobs[id] = {
		data, logo, fgColor, bgColor,
		stats: { total: 0, completed: 0, final: false, ready: false }
	};
	
	res.send({ id });
	doJob(id);
})

app.get('/', (req, res) => res.sendFile(__dirname + '/app.html'));

app.get('/jobs/:id', (req, res) => {
	if (!jobs[req.params.id]) return res.status(404).send({ message: 'Job not found!' });

	return res.send(jobs[req.params.id].stats);
});

app.get('/jobs/:id/archive.zip', async (req, res) => {
	const id = req.params.id;
	if (!jobs[id]) return res.status(404).send({ message: 'Job not found!' });

	res.download(`jobs/${id}/archive.zip`);

	delete jobs[id];
	await rimraf(`jobs/${id}`);
});

app.listen(PORT, () => console.log(`Running on port ${PORT}!`))


async function doJob(id) {
	const { data, logo, fgColor, bgColor } = jobs[id];
	const folder = 'jobs/' + id;
	await fs.mkdir(folder) // make a folder for this job
	await fs.mkdir(folder + '/codes') // make a folder for the codes
	
	let limage;
	if (logo) {
		limage = new Image;
		limage.src = logo.data;
	}

	Papa.parse(data.data.toString(), {
		header: true,
		skipEmptyLines: true,
		step: async (res) => {
			jobs[id].stats.total++;
			const canvas = await makeCode(res.data, fgColor, bgColor, limage);
			const key = res.meta.fields[0];
			const unique = res.data[key];
			await fs.writeFile(`${folder}/codes/${unique}.png`, canvas.toBuffer()); // write the file
			jobs[id].stats.completed++;
			checkZipUp(id);
		},
		complete: async () => jobs[id].stats.final = true
	});
}

async function makeCode(row, fg, bg, logo) {
	const canvas = createCanvas(256, 256);
	const ctx = canvas.getContext('2d');

	const data = Object.entries(row).map(([key, val]) => `${key}: ${val}`).join('\n');
	await qrcode.toCanvas(canvas, data, {
		width: 256,
		errorCorrectionLevel: 'high',
		margin: 1,
		color: {
			light: bg,
			dark: fg
		}
	});

	if (logo) {
		let width = logo.naturalWidth, height = logo.naturalHeight;
		if (height > width) {
			width = width / height * LOGO_SIZE;
			height = LOGO_SIZE;
		} else {
			height = height / width * LOGO_SIZE;
			width = LOGO_SIZE;
		}
		ctx.drawImage(logo, 128 - width / 2, 128 - height / 2, width, height);
	}
	
	return canvas;
}

async function checkZipUp(id) {
	const job = jobs[id];
	const root = `jobs/${id}`
	if (job.stats.final && job.stats.total === job.stats.completed) {
		// Ready to zip!
		await zip(root + '/codes', root + '/archive.zip');
		job.stats.ready = true;
	}
}