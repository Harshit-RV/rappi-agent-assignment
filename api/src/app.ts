import express from 'express';
import cors from 'cors';
import config from './config';
import runsRouter from './runs/routes';
import scenariosRouter from './erp/routes';

const app = express();

app.use(cors());

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/scenarios', scenariosRouter);
app.use('/api/runs', runsRouter);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
