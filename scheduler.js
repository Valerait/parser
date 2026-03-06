const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

let currentJob = null;

async function runSearch() {
  console.log(`[${new Date().toISOString()}] Running scheduled search...`);

  try {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
    });

    const data = await response.json();

    if (data.error) {
      console.error(`Search error: ${data.error}`);
    } else {
      console.log(`Search completed. Found ${data.count} results.`);
      if (data.errors?.length > 0) {
        console.warn('Errors during search:', data.errors);
      }
    }
  } catch (error) {
    console.error('Failed to run search:', error.message);
  }
}

async function setupScheduler() {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { id: 'main' },
    });

    if (!config) {
      console.log('No schedule config found. Will re-check in 60 seconds...');
      return;
    }

    if (!config.scheduleEnabled) {
      console.log('Scheduler is disabled in settings.');
      if (currentJob) {
        currentJob.stop();
        currentJob = null;
      }
      return;
    }

    const [hours, minutes] = config.scheduleTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;

    if (currentJob) {
      currentJob.stop();
    }

    console.log(
      `Scheduling daily search at ${config.scheduleTime} (cron: ${cronExpression})`
    );

    currentJob = cron.schedule(cronExpression, () => {
      runSearch();
    });

    console.log('Scheduler is running. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Scheduler setup error:', error);
  }
}

// Re-check config every 60 seconds to pick up changes from UI
setInterval(async () => {
  await setupScheduler();
}, 60000);

setupScheduler();

process.on('SIGINT', async () => {
  console.log('\nShutting down scheduler...');
  if (currentJob) currentJob.stop();
  await prisma.$disconnect();
  process.exit(0);
});
