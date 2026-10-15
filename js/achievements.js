// Achievements: small goals that teach the game and give players a reason to come back.
export const ACHIEVEMENTS = [
  { id: 'first_block', title: 'Foundation laid', desc: 'Place your first block.' },
  { id: 'builder_100', title: 'Master builder', desc: 'Place 100 blocks.' },
  { id: 'builder_1000', title: 'Lagos developer', desc: 'Place 1,000 blocks.' },
  { id: 'tower', title: 'Skyscraper dreams', desc: 'Build something 20 blocks high.' },
  { id: 'lights', title: 'NEPA who?', desc: 'Place 5 lamps or neon lights.' },
  { id: 'night', title: 'Lagos at night', desc: 'Stay out after dark.' },
  { id: 'beach', title: 'Beach day', desc: 'Walk down to Bar Beach.' },
  { id: 'market', title: 'Market run', desc: 'Visit Yaba Market.' },
  { id: 'park', title: 'Fresh air', desc: 'Visit Freedom Park.' },
  { id: 'greet', title: 'Good neighbour', desc: 'Say hello to 5 residents.' },
  { id: 'danfo', title: 'Oshodi! Oshodi!', desc: 'Get a danfo to honk at you.' },
  { id: 'swim', title: 'Splash!', desc: 'Go for a swim.' },
  { id: 'fly', title: 'Above the traffic', desc: 'Fly higher than 40 blocks.' },
  { id: 'blueprint', title: 'Instant estate', desc: 'Place a blueprint.' },
  { id: 'fashion', title: 'Fashion house', desc: 'Build with every Ankara and Adire fabric.' },
  { id: 'door', title: 'Knock knock', desc: 'Place a door and open it.' },
  { id: 'undo', title: 'Omo, I make mistake', desc: 'Undo something.' },
  { id: 'photo', title: 'Say cheese', desc: 'Take a photo.' },
  { id: 'name', title: 'Home sweet home', desc: 'Give your plot a name.' },
  { id: 'share', title: 'Show and tell', desc: 'Copy your build code to share it.' },
  { id: 'generator', title: 'I better pass my neighbour', desc: 'Start a generator.' },
];

// Rotates weekly so returning players always have something to aim for.
const CHALLENGES = [
  'Build a Mama Put canteen with seats for customers.',
  'Build your dream duplex.',
  'Build a beach house fit for Lekki.',
  'Build the tallest tower on your plot.',
  'Build a night market glowing with lights.',
  'Build a tech hub for Yaba startups.',
  'Build a football pitch for the street.',
  'Recreate a Lagos landmark you love.',
];
export function weeklyChallenge(date = new Date()) {
  const week = Math.floor((date.getTime() / 86400000 + 3) / 7);
  return CHALLENGES[week % CHALLENGES.length];
}

export function createAchievements(saved, onUnlock) {
  const got = { ...(saved?.got || {}) };
  const stats = { placed: 0, lights: 0, greeted: 0, fabrics: [], ...(saved?.stats || {}) };
  return {
    got, stats,
    has: (id) => !!got[id],
    unlock(id) {
      if (got[id] || !ACHIEVEMENTS.find((a) => a.id === id)) return;
      got[id] = Date.now();
      onUnlock(ACHIEVEMENTS.find((a) => a.id === id));
    },
    count: () => Object.keys(got).length,
    toJSON: () => ({ got, stats }),
  };
}
