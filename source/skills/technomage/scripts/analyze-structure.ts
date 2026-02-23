
import fs from 'fs';
import path from 'path';

const VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || "c:/Users/Petr/Documents/Obsidian/Technomage";

interface Node {
    name: string;
    type: 'file' | 'directory';
    children?: Node[];
    size?: number;
    mtime?: Date;
}

function buildTree(dir: string, depth: number = 0): Node | null {
    if (depth > 3) return null; // Limit depth to avoid massive output
    try {
        const stats = fs.statSync(dir);
        if (!stats.isDirectory()) {
            return {
                name: path.basename(dir),
                type: 'file',
                size: stats.size,
                mtime: stats.mtime
            };
        }

        const children = fs.readdirSync(dir)
            .filter(f => !f.startsWith('.')) // Ignore hidden files
            .map(f => buildTree(path.join(dir, f), depth + 1))
            .filter((n): n is Node => n !== null);

        return {
            name: path.basename(dir),
            type: 'directory',
            children
        };
    } catch (e) {
        return null;
    }
}

const tree = buildTree(VAULT_ROOT);

function simplifyTree(node: Node, depth: number = 0): any {
    if (node.type === 'file') return node.name;
    if (depth > 2) return `${node.name}/... (${node.children?.length} items)`;
    
    return {
        [node.name]: node.children?.map(c => simplifyTree(c, depth + 1))
    };
}

console.log(JSON.stringify(simplifyTree(tree!), null, 2));
