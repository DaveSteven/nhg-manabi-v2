FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web apps/web
COPY apps/admin apps/admin
RUN pnpm --filter web build && pnpm --filter admin build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/build/client /usr/share/nginx/html/web
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html/admin
