import { ethers } from 'ethers';
import VAULT_ABI from './Lido_integrate/vault-abi';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Validate environment variables
function validateEnvironment() {
    const required = ['ALCHEMY_URL', 'PRIVATE_KEY', 'VAULT_CONTRACT_ADDRESS'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length) {
        throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
}

async function performUpdate(vault: ethers.Contract) {
    const needsUpdate = await vault.isUpdateNeeded();
    if (!needsUpdate) {
        console.log('No update needed at this time');
        return false;
    }

    const tx = await vault.triggerDailyUpdate();
    console.log(`Update triggered. Transaction hash: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Update completed. Block number: ${receipt.blockNumber}`);
    return true;
}

async function scheduleUpdate() {
    try {
        validateEnvironment();

        const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL!);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
        const vault = new ethers.Contract(
            process.env.VAULT_CONTRACT_ADDRESS!,
            VAULT_ABI(),
            wallet
        );

        console.log('Daily update service started');

        setInterval(async () => {
            try {
                await performUpdate(vault);
            } catch (error) {
                console.error('Update attempt failed:', error);
                
                // Schedule retry
                setTimeout(async () => {
                    try {
                        await performUpdate(vault);
                    } catch (retryError) {
                        console.error('Retry failed:', retryError);
                    }
                }, RETRY_DELAY);
            }
        }, UPDATE_INTERVAL);

    } catch (error) {
        console.error('Failed to initialize update service:', error);
        process.exit(1);
    }
}

// Add process handling for clean shutdown
process.on('SIGINT', () => {
    console.log('Update service shutting down...');
    process.exit(0);
});

export default scheduleUpdate;

// Execute if running directly
if (require.main === module) {
    scheduleUpdate().catch(console.error);
}