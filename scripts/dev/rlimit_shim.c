#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
/* Clamp RLIMIT_NOFILE (7) raises to the hard limit: this container cannot raise it. */
struct rl { uint64_t cur, max; };
typedef int (*prl_t)(int, int, const struct rl *, struct rl *);
static int clamp(int pid, int res, const struct rl *nl, struct rl *ol) {
  prl_t real = (prl_t)dlsym(RTLD_NEXT, "prlimit64");
  if (nl && res == 7) {
    struct rl cur; real(pid, res, 0, &cur);
    struct rl c = *nl;
    if (c.max > cur.max) c.max = cur.max;
    if (c.cur > c.max) c.cur = c.max;
    return real(pid, res, &c, ol);
  }
  return real(pid, res, nl, ol);
}
int prlimit64(int pid, int res, const struct rl *nl, struct rl *ol) { return clamp(pid, res, nl, ol); }
int prlimit(int pid, int res, const struct rl *nl, struct rl *ol) { return clamp(pid, res, nl, ol); }
int setrlimit(int res, const struct rl *nl) { return clamp(0, res, nl, 0); }
int setrlimit64(int res, const struct rl *nl) { return clamp(0, res, nl, 0); }
