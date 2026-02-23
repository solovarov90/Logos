import fs from 'fs';
import path from 'path';

// Helper to get vault path from env or args
const getVaultPath = (): string => {
  const envPath = process.env.OBSIDIAN_VAULT_PATH;
  if (envPath) return envPath;
  const argPath = process.argv[2];
  if (argPath) return argPath;
  throw new Error("Vault path not found. Set OBSIDIAN_VAULT_PATH env var or pass as argument.");
};

const VAULT_PATH = getVaultPath();
const QUERY = process.argv[2] || process.argv[3]; // Arg 2 or 3 depending on how it's called

if (!QUERY) {
  console.error("Please provide a search query.");
  process.exit(1);
}

const IGNORE_DIRS = ['.git', '.obsidian', '.trash', '.stfolder', '.stversions', 'node_modules'];

function searchInDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  
  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (IGNORE_DIRS.includes(file)) continue;
    
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      searchInDir(fullPath);
    } else if (file.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(QUERY.toLowerCase())) {
          // Highlight the match slightly for readability
          const relativePath = path.relative(VAULT_PATH, fullPath);
          console.log(`[${relativePath}:${index + 1}] ${line.trim()}`);
        }
      });
    }
  }
}

console.log(`Searching for "${QUERY}" in ${VAULT_PATH}...`);
searchInDir(VAULT_PATH);
