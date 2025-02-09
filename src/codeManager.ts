import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { CommitOptions } from './types';

export async function createOrModifyProject(
    repoPath: string | undefined,
    files: { [filePath: string]: string }
) {
    const basePath = repoPath || process.cwd(); // Usa o repositório existente ou a pasta atual
    const git: SimpleGit = simpleGit(basePath);
    
    try {
        if(!repoPath){
            //se não tem repositório, assume que é um projeto novo
            const isRepo = await git.checkIsRepo();
            if(!isRepo){
                await git.init();
            }
        }
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(basePath, filePath);
            const dir = path.dirname(fullPath);
            
            await fs.mkdir(dir, { recursive: true }); // Cria diretórios se não existirem
            await fs.writeFile(fullPath, content, 'utf-8');
        }
    } catch (error: any) {
        throw new Error(`Erro ao criar ou modificar arquivos: ${error.message}`);
    }
}


export async function commitChanges(repoPath: string | undefined, options: CommitOptions): Promise<void> {
    const basePath = repoPath || process.cwd();
    const git: SimpleGit = simpleGit(basePath);
    
    if (options.accepted) {
        await git.add('./*');
        await git.commit('feat: Automatic changes by coding agent');
        console.log('Changes committed successfully.');
    } else if (!options.keepChanges) {
        await git.reset(['--hard', 'HEAD']);
        console.log('Changes discarded.');
    } else{
        console.log("Changes not commited, but not discarded")
    }
}