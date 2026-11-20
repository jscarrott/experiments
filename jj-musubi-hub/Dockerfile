ARG BUILD_FROM
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG MUSUBI_VERSION
ARG MUSUBI_SHA256_AMD64
ARG MUSUBI_SHA256_AARCH64

# git: the hub keeps each hive in a bare git repository.
RUN apk add --no-cache openssh-server git

# The release's static musl build of musubi, checked against the SHA256SUMS of that release.
RUN set -eux; \
    case "${BUILD_ARCH}" in \
      amd64) target=x86_64-unknown-linux-musl; sum="${MUSUBI_SHA256_AMD64}" ;; \
      aarch64) target=aarch64-unknown-linux-musl; sum="${MUSUBI_SHA256_AARCH64}" ;; \
      *) echo "unsupported arch ${BUILD_ARCH}" >&2; exit 1 ;; \
    esac; \
    name="jj-musubi-${MUSUBI_VERSION}-${target}"; \
    curl -fsSL -o /tmp/musubi.tar.gz \
      "https://github.com/bos/jj-musubi/releases/download/v${MUSUBI_VERSION}/${name}.tar.gz"; \
    echo "${sum}  /tmp/musubi.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/musubi.tar.gz -C /tmp; \
    install -m 0755 "/tmp/${name}/musubi" /usr/local/bin/musubi; \
    rm -rf /tmp/musubi.tar.gz "/tmp/${name}"; \
    musubi --version

# The hub runs as this user, and other machines ssh in as it. Its home is in /data, so the
# hub's hives, its state and the keys musubi enrolls survive restarts and updates. The
# password is "*" rather than "!": sshd refuses a locked account even for key logins.
RUN set -eux; \
    adduser -D -h /data/musubi -s /bin/sh musubi; \
    echo 'musubi:*' | chpasswd -e

COPY rootfs /

LABEL \
  io.hass.version="${MUSUBI_VERSION}" \
  io.hass.type="addon" \
  io.hass.arch="${BUILD_ARCH}"
