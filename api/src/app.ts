import express from 'express';
import cors from 'cors';
import config from './config';
import runsRouter from './runs/routes';

const app = express();

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  })
);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/runs', runsRouter);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
