import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Helper to get vault path from env or args
const getVaultPath = (): string => {
  const envPath = process.env.OBSIDIAN_VAULT_PATH;
  if (envPath) return envPath;
  const argPath = process.argv[2];
  if (argPath) return argPath;
  throw new Error("Vault path not found. Set OBSIDIAN_VAULT_PATH env var or pass as argument.");
};

const VAULT_PATH = getVaultPath();

// Only scan these directories
const TARGET_DIRS = ['03_Концепты'];

interface Node {
  path: string;
  name: string; // filename without extension
  links: string[]; // outgoing links
  backlinks: string[]; // incoming links from other files
}

const graph: Record<string, Node> = {};

// 1. Scan files and build nodes
function scanDirectory(dir: string): void {
  const fullPath = path.join(VAULT_PATH, dir);
  if (!fs.existsSync(fullPath)) return;

  const files = fs.readdirSync(fullPath);
  for (const file of files) {
    if (file.endsWith('.md')) {
      const name = file.replace('.md', '');
      const content = fs.readFileSync(path.join(fullPath, file), 'utf-8');
      
      // Extract wiki links [[Link]]
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      const links: string[] = [];
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        links.push(match[1].trim());
      }

      graph[name] = {
        path: path.join(dir, file),
        name,
        links,
        backlinks: []
      };
    }
  }
}

TARGET_DIRS.forEach(scanDirectory);

// 2. Build backlinks
Object.values(graph).forEach(node => {
  node.links.forEach(linkName => {
    if (graph[linkName]) {
      graph[linkName].backlinks.push(node.name);
    }
  });
});

// 3. Analyze
const isolatedNodes: string[] = [];
const missingNodes: Set<string> = new Set();

Object.values(graph).forEach(node => {
  if (node.backlinks.length < 2) {
    isolatedNodes.push(node.name);
  }
  node.links.forEach(linkName => {
    if (!graph[linkName]) {
      missingNodes.add(linkName);
    }
  });
});

// 4. Output Report
console.log(`# Анализ Графа Знаний (Technomage)`);
console.log(`\n**Всего концептов:** ${Object.keys(graph).length}`);

console.log(`\n## 🏳️ Белые пятна (Missing Nodes)`);
console.log(`Концепты, на которые есть ссылки, но нет заметок:`);
if (missingNodes.size > 0) {
  Array.from(missingNodes).forEach(name => console.log(`- [[${name}]]`));
} else {
  console.log(`- (Нет пропущенных узлов)`);
}

console.log(`\n## 🏝️ Изолированные острова (Isolated Nodes)`);
console.log(`Концепты с менее чем 2 входящими связями:`);
if (isolatedNodes.length > 0) {
  isolatedNodes.forEach(name => console.log(`- [[${name}]] (${graph[name].backlinks.length} links)`));
} else {
  console.log(`- (Все узлы хорошо связаны)`);
}
