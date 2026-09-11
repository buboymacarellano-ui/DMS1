#!/usr/bin/env node
/**
 * DMS1 Render Sync Quick-Start Setup
 * 
 * This script guides you through initial setup for bidirectional sync
 * between your local DMS1 and Render deployment.
 * 
 * Run: node scripts/setup-sync.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

async function checkPrerequisites() {
  console.log('\n✅ Checking Prerequisites...\n');

  const checks = [];

  // Check git
  try {
    await execAsync('git --version');
    checks.push({ name: 'Git', status: '✓' });
  } catch {
    checks.push({ name: 'Git', status: '✗ (REQUIRED - install from git-scm.com)' });
  }

  // Check node
  try {
    await execAsync('node --version');
    checks.push({ name: 'Node.js', status: '✓' });
  } catch {
    checks.push({ name: 'Node.js', status: '✗ (REQUIRED - install from nodejs.org)' });
  }

  // Check if in correct directory
  if (fs.existsSync('package.json')) {
    checks.push({ name: 'Project Directory', status: '✓' });
  } else {
    checks.push({ name: 'Project Directory', status: '✗' });
  }

  // Check if git is already initialized
  if (fs.existsSync('.git')) {
    checks.push({ name: 'Git Repository', status: '✓ (already initialized)' });
  } else {
    checks.push({ name: 'Git Repository', status: '○ (will initialize)' });
  }

  checks.forEach(c => console.log(`  ${c.status.padEnd(40)} ${c.name}`));

  const hasGit = checks.some(c => c.name === 'Git' && c.status.includes('✓'));
  const hasNode = checks.some(c => c.name === 'Node.js' && c.status.includes('✓'));

  if (!hasGit || !hasNode) {
    console.log('\n❌ Missing prerequisites. Please install Git and Node.js first.');
    process.exit(1);
  }

  return checks.find(c => c.name === 'Git Repository').status.includes('already');
}

async function initializeGit() {
  console.log('\n📦 Initialize Git Repository\n');

  const isInitialized = fs.existsSync('.git');
  if (isInitialized) {
    console.log('✓ Git already initialized');
    return;
  }

  console.log('Initializing git...');
  await execAsync('git init');
  console.log('✓ Git initialized');

  console.log('Staging all files...');
  await execAsync('git add .');
  console.log('✓ Files staged');

  console.log('Creating initial commit...');
  await execAsync('git commit -m "Initial commit: DMS1 project setup"');
  console.log('✓ Initial commit created');
}

async function setupGitHub() {
  console.log('\n🐙 GitHub Integration Setup\n');

  const hasRemote = await checkGitRemote();

  if (hasRemote) {
    const { stdout } = await execAsync('git remote get-url origin');
    console.log(`✓ Git remote already configured: ${stdout.trim()}`);
    return stdout.trim();
  }

  console.log('To connect to GitHub, you need:');
  console.log('  1. A GitHub account (https://github.com/signup)');
  console.log('  2. A new repository named "DMS1" (https://github.com/new)');
  console.log('  3. Your GitHub Personal Access Token (for authentication)');

  const proceed = await question('\nDo you have a GitHub repo ready? (yes/no): ');
  if (proceed.toLowerCase() !== 'yes') {
    console.log('\n📋 Setup these manually, then run this script again.');
    return null;
  }

  const username = await question('\nGitHub username: ');
  const repo = await question('Repository name (default: DMS1): ') || 'DMS1';
  const remoteUrl = `https://github.com/${username}/${repo}.git`;

  console.log(`\nAdding remote: ${remoteUrl}`);
  try {
    await execAsync(`git remote add origin ${remoteUrl}`);
    console.log('✓ Remote added');

    console.log('Setting default branch to "main"...');
    await execAsync('git branch -M main');
    console.log('✓ Branch set');

    return remoteUrl;
  } catch (err) {
    console.log('⚠️  Could not add remote. Do it manually:');
    console.log(`    git remote add origin ${remoteUrl}`);
    console.log(`    git branch -M main`);
    return null;
  }
}

async function checkGitRemote() {
  try {
    await execAsync('git remote get-url origin');
    return true;
  } catch {
    return false;
  }
}

async function setupRender() {
  console.log('\n🚀 Render Deployment Setup\n');

  console.log('To connect to Render, you need:');
  console.log('  1. A Render account (https://render.com)');
  console.log('  2. Existing "dms1" service');
  console.log('  3. API Key from https://dashboard.render.com/api-tokens');
  console.log('  4. Service ID (from service settings)');

  const hasRenderKey = !!process.env.RENDER_API_KEY;
  console.log(`\nRender API Key configured: ${hasRenderKey ? '✓' : '✗'}`);

  if (!hasRenderKey) {
    const answer = await question('\nWould you like to set RENDER_API_KEY now? (yes/no): ');
    if (answer.toLowerCase() === 'yes') {
      const apiKey = await question('Paste your Render API Key: ');
      const serviceId = await question('Render Service ID: ');

      console.log('\n📝 Add these to your environment:');
      console.log(`\nWindows (PowerShell):`);
      console.log(`  [Environment]::SetEnvironmentVariable("RENDER_API_KEY", "${apiKey}", "User")`);
      console.log(`  [Environment]::SetEnvironmentVariable("RENDER_SERVICE_ID", "${serviceId}", "User")`);

      console.log(`\nWindows (Command Prompt):`);
      console.log(`  setx RENDER_API_KEY ${apiKey}`);
      console.log(`  setx RENDER_SERVICE_ID ${serviceId}`);

      console.log(`\nMacOS/Linux (.bashrc or .zshrc):`);
      console.log(`  export RENDER_API_KEY=${apiKey}`);
      console.log(`  export RENDER_SERVICE_ID=${serviceId}`);

      console.log('\n⏰ Restart your terminal after setting environment variables');
    }
  }
}

async function setupTaskScheduler() {
  console.log('\n⏲️  Windows Task Scheduler Setup\n');

  const os = require('os');
  if (os.platform() !== 'win32') {
    console.log('⏭️  Task Scheduler is Windows-only. Skipping...');
    return;
  }

  console.log('To automate sync, create a Scheduled Task:');
  console.log('\n1. Open Task Scheduler (search "Task Scheduler")');
  console.log('2. Right-click "Task Scheduler Library" → "Create Basic Task"');
  console.log('3. Name: "DMS1-Auto-Sync"');
  console.log('4. Trigger: Daily at 2:00 AM (or every 6 hours)');
  console.log('5. Action → New:');
  console.log('   Program: C:\\Windows\\System32\\cmd.exe');
  console.log('   Arguments: /c C:\\Users\\buboy\\OneDrive\\Desktop\\DMS1\\scripts\\sync-schedule.bat');
  console.log('6. Conditions: Run with highest privileges');

  const automated = await question('\nSet up task now? (manual: open Task Scheduler yourself)? ');
  if (automated.toLowerCase() === 'yes') {
    console.log('⚠️  PowerShell script required. See SYNC-SETUP.md for details.');
  }
}

async function testSync() {
  console.log('\n🧪 Test Sync\n');

  try {
    const { stdout } = await execAsync('npm run sync:render:status');
    console.log('Sync status:\n', stdout);
    console.log('✓ Sync system working');
  } catch (err) {
    console.log('⚠️  Sync test failed. See SYNC-SETUP.md for debugging.');
  }
}

async function showNextSteps() {
  console.log('\n✨ Setup Complete!\n');
  console.log('📚 Next Steps:\n');
  console.log('1. Push to GitHub (first time only):');
  console.log('   git push -u origin main\n');

  console.log('2. Deploy to Render:');
  console.log('   - Push triggers auto-deploy to Render');
  console.log('   - Monitor at https://dashboard.render.com\n');

  console.log('3. Test sync commands:');
  console.log('   npm run sync:render:status    # Check sync status');
  console.log('   npm run sync:render:push      # Push to Render');
  console.log('   npm run sync:render:pull      # Pull from Render\n');

  console.log('4. Enable automated sync (Task Scheduler):');
  console.log('   - See SYNC-SETUP.md Phase 3\n');

  console.log('📖 Documentation: See SYNC-SETUP.md for complete guide\n');
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                  DMS1 Render Sync Quick-Start                      ║
║                                                                    ║
║  This script sets up bidirectional sync between local and Render  ║
║  - Append-only mode (safe: never deletes)                         ║
║  - Automated with Git + GitHub + Render                           ║
╚════════════════════════════════════════════════════════════════════╝
  `);

  try {
    // Phase 1: Prerequisites
    const gitInitialized = await checkPrerequisites();

    // Phase 2: Git setup
    if (!gitInitialized) {
      await initializeGit();
    }

    // Phase 3: GitHub
    const remoteUrl = await setupGitHub();
    if (remoteUrl) {
      console.log('\n✅ GitHub setup complete. To push:');
      console.log(`   git push -u origin main`);
    }

    // Phase 4: Render
    await setupRender();

    // Phase 5: Task Scheduler (Windows)
    await setupTaskScheduler();

    // Phase 6: Test
    await testSync();

    // Phase 7: Summary
    await showNextSteps();

    rl.close();
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    rl.close();
    process.exit(1);
  }
}

main();
