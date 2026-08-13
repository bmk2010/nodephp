import express from 'express';
import path from 'path';
import fs from 'fs';
import { executeNodePHP } from './engine.js';

export function startServer(port = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.all('*', (req, res) => {
    const reqUrl = req.path;

    // Faqat .np bilan tugagan so'rovlarni qabul qilamiz
    if (!reqUrl.endsWith('.np')) {
      return res.status(404).json({ error: "404 Not Found: Faqat .np fayllari qo'llab-quvvatlanadi" });
    }

    const filePath = path.join(process.cwd(), reqUrl);

    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      executeNodePHP(filePath, req, res);
    } else {
      res.status(404).json({ error: "404 Not Found: Fayl topilmadi" });
    }
  });

  return app.listen(port, () => {
    console.log(`\n🐘 NodePHP server ishga tushdi: http://localhost:${port}\n`);
  });
}