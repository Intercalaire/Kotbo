import { writeFileSync } from 'fs';
import { generateLeaderboardImage } from '../src/services/core/imageService.js';
import { generateRankCard } from '../src/services/progression/levelingService.js';
import type { GuildMember } from 'discord.js';

async function main() {
  const artifactDir = '/home/klaynight/.gemini/antigravity-ide/brain/fd4ae803-699d-476c-976b-f6eeeed07bd5';

  // 1. Generate Mock Leaderboard
  const mockMembers = [
    { name: 'Klaynight', score: 1250 },
    { name: 'Elouan', score: 980 },
    { name: 'Alice_Wonderland', score: 850 },
    { name: 'BobTheBuilder', score: 720 },
    { name: 'CharlieBrown', score: 500 },
    { name: 'DeveloperWithAnExtremelyLongUsernameHere', score: 320 },
    { name: 'Shorty', score: 150 },
    { name: 'ZeroActivityUser', score: 0 },
    { name: 'NinthRanker', score: 5 },
    { name: 'TenthRanker', score: 2 }
  ];

  const leaderboardBuf = await generateLeaderboardImage(mockMembers, 'messages', 30);
  writeFileSync(`${artifactDir}/mock_leaderboard.png`, leaderboardBuf);
  console.log('Leaderboard image written to', `${artifactDir}/mock_leaderboard.png`);

  // 2. Generate Mock Rank Card
  const mockMember = {
    displayName: 'DeveloperWithAnExtremelyLongUsernameHere',
    user: {
      username: 'dev_with_long_username',
      discriminator: '0',
      displayAvatarURL: () => 'https://discord.com/assets/2c21a187d62b16797c963db94a73bfc4.png', // invalid / stub avatar
    },
    presence: {
      status: 'online'
    }
  } as unknown as GuildMember;

  const rankCardBuf = await generateRankCard(mockMember, 12, 18500, 6, 'fr');
  writeFileSync(`${artifactDir}/mock_rank.png`, rankCardBuf);
  console.log('Rank card image written to', `${artifactDir}/mock_rank.png`);
}

main().catch(console.error);
