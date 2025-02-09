import { runCLI } from './cli';
import { setupGoogleAI } from './googleAI';

async function main() {
    try{
        await setupGoogleAI();
        await runCLI();
    } catch(error: any){
        console.error("Ocorreu um erro:", error.message)
    }
}
main();