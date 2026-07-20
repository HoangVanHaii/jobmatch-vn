# JobMatch VN Backend

Backend service cho JobMatch VN - Hệ thống tìm việc thông minh với AI.

## Tech Stack

- **Node.js** + **TypeScript** + **Express**
- **PostgreSQL** + **Drizzle ORM** + **pgvector**
- **Redis** + **BullMQ**
- **Socket.IO** (real-time)
- **MinIO** (S3-compatible storage)
- **MailHog** (email testing)

## Development Setup

### Option 1: Using Docker (Recommended)

```bash
# Start all services (Backend, PostgreSQL, Redis, MinIO, MailHog)
./dev.sh

# Or manually:
docker-compose -f docker-compose.dev.yml up --build -d
```

### Option 2: Local Development

1. **Start infrastructure services** (PostgreSQL, Redis, MinIO, MailHog):
```bash
docker-compose up -d postgres redis minio mailhog
```

2. **Install dependencies**:
```bash
npm install
```

3. **Copy environment variables**:
```bash
cp .env.example .env
# Edit .env to match your setup
```

4. **Run database migrations**:
```bash
npm run db:migrate
```

5. **Seed database** (optional):
```bash
npm run db:seed
```

6. **Start development server**:
```bash
npm run dev
```

## Service URLs

- **API**: http://localhost:5000
- **API Docs** (if enabled): http://localhost:5000/api/docs
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379
- **MinIO Console**: http://localhost:9001
- **MailHog UI**: http://localhost:8025

## Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues
npm run typecheck    # Run TypeScript type checking
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
npm run test:e2e     # Run E2E tests
npm run db:generate  # Generate database migrations
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database with test data
npm run db:studio    # Open Drizzle Studio (DB GUI)
```

## Project Structure

```
backend/
├── src/
│   ├── config/        # Configuration (DB, Redis, Logger)
│   ├── controllers/   # Route handlers
│   ├── services/      # Business logic
│   ├── models/        # Data models
│   ├── middleware/    # Express middleware
│   ├── routes/        # API routes
│   ├── jobs/          # BullMQ workers
│   ├── socket/        # Socket.IO handlers
│   ├── utils/         # Utility functions
│   └── db/            # Database schemas & migrations
├── scripts/           # Database scripts
├── tests/             # Test files
├── server.ts          # Entry point
└── tsconfig.json      # TypeScript config
```

## Environment Variables

See `.env.example` for all available configuration options.

## Docker

### Production Build

```bash
docker build -t jobmatch-vn-backend .
docker run -p 5000:5000 jobmatch-vn-backend
```

### Development with Docker

```bash
docker-compose -f docker-compose.dev.yml up --build
```

## Troubleshooting

### Port already in use
If port 5000 is already in use, change `PORT` in `.env` file.

### Database connection issues
- Make sure PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Run `docker-compose logs postgres` to see PostgreSQL logs

### Redis connection issues
- Make sure Redis is running
- Check `REDIS_URL` in `.env`

### Node modules issues
```bash
rm -rf node_modules package-lock.json
npm install
```

## License

Proprietary - JobMatch VN
