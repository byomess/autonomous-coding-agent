// src/testRunner.ts
import { TestResult } from './types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';

const execAsync = promisify(exec);

export async function runTests(repositoryPath: string, testCommand: string): Promise<TestResult> {
    try {
        const { stdout, stderr } = await execAsync(testCommand, { cwd: repositoryPath });
        // IMPORTANT:  Success is determined by the *absence* of an error being thrown.
        // If execAsync completes without throwing, the tests passed.
        return { passed: true, details: stdout };
    } catch (error: any) {
        // execAsync throws an error if the process exits with a non-zero exit code.
        // This is the correct way to detect test failures.
        let details = error.message; // error.message includes stdout and stderr
        if (error.stdout) {
            details += "\n" + error.stdout;
        }
        if(error.stderr){
            details += "\n" + error.stderr
        }
        return { passed: false, details: details };
    }
}

async function getIgnoreFilter(dir: string): Promise<Ignore> {
    const ig = ignore();
    const gitignorePath = path.join(dir, '.gitignore');
    try {
        const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
        ig.add(gitignoreContent);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.warn(`Error reading .gitignore: ${error.message}`);
        }
    }

    ig.add(['node_modules', 'dist', '.git', 'public', '.*']);
    return ig;
}

export async function getProjectFiles(dir: string): Promise<string[]> {
    let files: string[] = [];
    const ig = await getIgnoreFilter(dir);

    async function traverse(currentDir: string) {
        try{
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                const relativePath = path.relative(dir, fullPath);
                if (ig.ignores(relativePath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await traverse(fullPath);
                } else {
                    files.push(relativePath);
                }
            }
        } catch(err){
            console.warn(`Could not read directory ${currentDir}. Skipping...`, err)
        }
    }

    await traverse(dir);
    return files;
}