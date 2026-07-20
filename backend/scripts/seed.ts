/**
 * Database seed script — chạy sau migrate
 */
import 'dotenv/config';
import { db, pool } from '../src/config/database';
import { skills, plans } from '../src/db/schema';
import { logger } from '../src/config/logger';

const seed = async (): Promise<void> => {
  logger.info('Seeding...');

  // Skills phổ biến cho IT
  const techSkills = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#',
    'React', 'Vue.js', 'Angular', 'Next.js', 'Nuxt.js', 'Svelte',
    'Node.js', 'Express', 'NestJS', 'FastAPI', 'Django', 'Spring Boot',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
    'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
    'Git', 'CI/CD', 'Jenkins', 'GitHub Actions',
    'REST API', 'GraphQL', 'gRPC', 'WebSocket',
    'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'NLP',
    'React Native', 'Flutter', 'iOS', 'Android', 'Swift', 'Kotlin',
  ];

  await db.insert(skills).values(techSkills.map((name) => ({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category: 'tech',
  }))).onConflictDoNothing();

  logger.info(`✅ Seeded ${techSkills.length} skills`);
  await pool.end();
};

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});