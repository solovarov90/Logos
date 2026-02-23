
import fs from 'fs';
import path from 'path';

const VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || "c:/Users/Petr/Documents/Obsidian/Technomage";
const JOURNAL_DIR = path.join(VAULT_ROOT, "04_Журнал");

function scanDirectory(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(scanDirectory(file));
      } else {
        results.push(file);
      }
    });
  } catch (err) {
    // Ignore errors for now
  }
  return results;
}

interface DayStats {
    date: string;
    energy: string;
    mode: string;
    practices: string;
}

function extractStats(content: string): Partial<DayStats> {
    const stats: Partial<DayStats> = {};
    
    const energyMatch = content.match(/Energy::\s*(.*)/i);
    if (energyMatch) stats.energy = energyMatch[1].trim();

    const modeMatch = content.match(/Mode::\s*(.*)/i);
    if (modeMatch) stats.mode = modeMatch[1].trim();

    // Naive practice count extraction logic - adjust based on actual format
    const practices = (content.match(/-\s*\[x\]/gi) || []).length;
    if (practices > 0) stats.practices = `${practices} done`;

    return stats;
}

const files = scanDirectory(JOURNAL_DIR);
const stats = files.map(f => {
    try {
        const content = fs.readFileSync(f, 'utf-8');
        const fileName = path.basename(f);
        const dayStats = extractStats(content);
        if (Object.keys(dayStats).length === 0) return null;
        return {
            file: fileName,
            ...dayStats
        };
    } catch (e) {
        return null;
    }
}).filter(Boolean);

console.log(JSON.stringify(stats, null, 2));
