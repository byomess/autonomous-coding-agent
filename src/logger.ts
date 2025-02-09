// src/logger.ts
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export class Logger {
    private logFilePath: string;

    constructor() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.logFilePath = path.join(process.cwd(), `agent_log_${timestamp}.log`);
    }

    private async writeLog(level: string, message: string): Promise<void> {
        const logMessage = `[${new Date().toISOString()}] [${level}] ${message}\n`;
        try {
            fs.appendFileSync(this.logFilePath, logMessage, 'utf8');
        } catch (error: any) {
            console.error(`Failed to write to log file: ${error.message}`);
        }
    }

     debug(message: string): void {
        if (process.env.NODE_DEBUG) { //Respect the NODE_DEBUG environment variable
            console.debug(chalk.gray(message));
            this.writeLog('DEBUG', message);
        }

    }

    info(message: string): void {
        console.info(message);
        this.writeLog('INFO', message);
    }

    warn(message: string): void {
        console.warn(chalk.yellow(message));
        this.writeLog('WARN', message);
    }

    error(message: string): void {
        console.error(chalk.red(message));
        this.writeLog('ERROR', message);
    }
}