var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/roofing-metre/vendor/big.cjs
var require_big = __commonJS({
  "scripts/roofing-metre/vendor/big.cjs"(exports, module) {
    (function(GLOBAL) {
      "use strict";
      var Big, DP = 20, RM = 1, MAX_DP = 1e6, MAX_POWER = 1e6, NE = -7, PE = 21, STRICT = false, NAME = "[big.js] ", INVALID = NAME + "Invalid ", INVALID_DP = INVALID + "decimal places", INVALID_RM = INVALID + "rounding mode", DIV_BY_ZERO = NAME + "Division by zero", P = {}, UNDEFINED = void 0, NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
      function _Big_() {
        function Big2(n) {
          var x = this;
          if (!(x instanceof Big2)) {
            return n === UNDEFINED && arguments.length === 0 ? _Big_() : new Big2(n);
          }
          if (n instanceof Big2) {
            x.s = n.s;
            x.e = n.e;
            x.c = n.c.slice();
          } else {
            if (typeof n !== "string") {
              if (Big2.strict === true && typeof n !== "bigint") {
                throw TypeError(INVALID + "value");
              }
              n = n === 0 && 1 / n < 0 ? "-0" : String(n);
            }
            parse(x, n);
          }
          x.constructor = Big2;
        }
        Big2.prototype = P;
        Big2.DP = DP;
        Big2.RM = RM;
        Big2.NE = NE;
        Big2.PE = PE;
        Big2.strict = STRICT;
        Big2.roundDown = 0;
        Big2.roundHalfUp = 1;
        Big2.roundHalfEven = 2;
        Big2.roundUp = 3;
        return Big2;
      }
      function parse(x, n) {
        var e, i, nl;
        if (!NUMERIC.test(n)) {
          throw Error(INVALID + "number");
        }
        x.s = n.charAt(0) == "-" ? (n = n.slice(1), -1) : 1;
        if ((e = n.indexOf(".")) > -1) n = n.replace(".", "");
        if ((i = n.search(/e/i)) > 0) {
          if (e < 0) e = i;
          e += +n.slice(i + 1);
          n = n.substring(0, i);
        } else if (e < 0) {
          e = n.length;
        }
        nl = n.length;
        for (i = 0; i < nl && n.charAt(i) == "0"; ) ++i;
        if (i == nl) {
          x.c = [x.e = 0];
        } else {
          for (; nl > 0 && n.charAt(--nl) == "0"; ) ;
          x.e = e - i - 1;
          x.c = [];
          for (e = 0; i <= nl; ) x.c[e++] = +n.charAt(i++);
        }
        return x;
      }
      function round(x, sd, rm, more) {
        var xc = x.c;
        if (rm === UNDEFINED) rm = x.constructor.RM;
        if (rm !== 0 && rm !== 1 && rm !== 2 && rm !== 3) {
          throw Error(INVALID_RM);
        }
        if (sd < 1) {
          more = rm === 3 && (more || !!xc[0]) || sd === 0 && (rm === 1 && xc[0] >= 5 || rm === 2 && (xc[0] > 5 || xc[0] === 5 && (more || xc[1] !== UNDEFINED)));
          xc.length = 1;
          if (more) {
            x.e = x.e - sd + 1;
            xc[0] = 1;
          } else {
            xc[0] = x.e = 0;
          }
        } else if (sd < xc.length) {
          more = rm === 1 && xc[sd] >= 5 || rm === 2 && (xc[sd] > 5 || xc[sd] === 5 && (more || xc[sd + 1] !== UNDEFINED || xc[sd - 1] & 1)) || rm === 3 && (more || !!xc[0]);
          xc.length = sd;
          if (more) {
            for (; ++xc[--sd] > 9; ) {
              xc[sd] = 0;
              if (sd === 0) {
                ++x.e;
                xc.unshift(1);
                break;
              }
            }
          }
          for (sd = xc.length; !xc[--sd]; ) xc.pop();
        }
        return x;
      }
      function stringify(x, doExponential, isNonzero) {
        var e = x.e, s = x.c.join(""), n = s.length;
        if (doExponential) {
          s = s.charAt(0) + (n > 1 ? "." + s.slice(1) : "") + (e < 0 ? "e" : "e+") + e;
        } else if (e < 0) {
          for (; ++e; ) s = "0" + s;
          s = "0." + s;
        } else if (e > 0) {
          if (++e > n) {
            for (e -= n; e--; ) s += "0";
          } else if (e < n) {
            s = s.slice(0, e) + "." + s.slice(e);
          }
        } else if (n > 1) {
          s = s.charAt(0) + "." + s.slice(1);
        }
        return x.s < 0 && isNonzero ? "-" + s : s;
      }
      P.abs = function() {
        var x = new this.constructor(this);
        x.s = 1;
        return x;
      };
      P.cmp = function(y) {
        var isneg, x = this, xc = x.c, yc = (y = new x.constructor(y)).c, i = x.s, j = y.s, k = x.e, l = y.e;
        if (!xc[0] || !yc[0]) return !xc[0] ? !yc[0] ? 0 : -j : i;
        if (i != j) return i;
        isneg = i < 0;
        if (k != l) return k > l ^ isneg ? 1 : -1;
        j = (k = xc.length) < (l = yc.length) ? k : l;
        for (i = -1; ++i < j; ) {
          if (xc[i] != yc[i]) return xc[i] > yc[i] ^ isneg ? 1 : -1;
        }
        return k == l ? 0 : k > l ^ isneg ? 1 : -1;
      };
      P.div = function(y) {
        var x = this, Big2 = x.constructor, a = x.c, b = (y = new Big2(y)).c, k = x.s == y.s ? 1 : -1, dp = Big2.DP;
        if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
          throw Error(INVALID_DP);
        }
        if (!b[0]) {
          throw Error(DIV_BY_ZERO);
        }
        if (!a[0]) {
          y.s = k;
          y.c = [y.e = 0];
          return y;
        }
        var bl, bt, n, cmp, ri, bz = b.slice(), ai = bl = b.length, al = a.length, r = a.slice(0, bl), rl = r.length, q = y, qc = q.c = [], qi = 0, p = dp + (q.e = x.e - y.e) + 1;
        q.s = k;
        k = p < 0 ? 0 : p;
        bz.unshift(0);
        for (; rl++ < bl; ) r.push(0);
        do {
          for (n = 0; n < 10; n++) {
            if (bl != (rl = r.length)) {
              cmp = bl > rl ? 1 : -1;
            } else {
              for (ri = -1, cmp = 0; ++ri < bl; ) {
                if (b[ri] != r[ri]) {
                  cmp = b[ri] > r[ri] ? 1 : -1;
                  break;
                }
              }
            }
            if (cmp < 0) {
              for (bt = rl == bl ? b : bz; rl; ) {
                if (r[--rl] < bt[rl]) {
                  ri = rl;
                  for (; ri && !r[--ri]; ) r[ri] = 9;
                  --r[ri];
                  r[rl] += 10;
                }
                r[rl] -= bt[rl];
              }
              for (; !r[0]; ) r.shift();
            } else {
              break;
            }
          }
          qc[qi++] = cmp ? n : ++n;
          if (r[0] && cmp) r[rl] = a[ai] || 0;
          else r = [a[ai]];
        } while ((ai++ < al || r[0] !== UNDEFINED) && k--);
        if (!qc[0] && qi != 1) {
          qc.shift();
          q.e--;
          p--;
        }
        if (qi > p) round(q, p, Big2.RM, r[0] !== UNDEFINED);
        return q;
      };
      P.eq = function(y) {
        return this.cmp(y) === 0;
      };
      P.gt = function(y) {
        return this.cmp(y) > 0;
      };
      P.gte = function(y) {
        return this.cmp(y) > -1;
      };
      P.lt = function(y) {
        return this.cmp(y) < 0;
      };
      P.lte = function(y) {
        return this.cmp(y) < 1;
      };
      P.minus = P.sub = function(y) {
        var i, j, t, xlty, x = this, Big2 = x.constructor, a = x.s, b = (y = new Big2(y)).s;
        if (a != b) {
          y.s = -b;
          return x.plus(y);
        }
        var xc = x.c.slice(), xe = x.e, yc = y.c, ye = y.e;
        if (!xc[0] || !yc[0]) {
          if (yc[0]) {
            y.s = -b;
          } else if (xc[0]) {
            y = new Big2(x);
          } else {
            y.s = 1;
          }
          return y;
        }
        if (a = xe - ye) {
          if (xlty = a < 0) {
            a = -a;
            t = xc;
          } else {
            ye = xe;
            t = yc;
          }
          t.reverse();
          for (b = a; b--; ) t.push(0);
          t.reverse();
        } else {
          j = ((xlty = xc.length < yc.length) ? xc : yc).length;
          for (a = b = 0; b < j; b++) {
            if (xc[b] != yc[b]) {
              xlty = xc[b] < yc[b];
              break;
            }
          }
        }
        if (xlty) {
          t = xc;
          xc = yc;
          yc = t;
          y.s = -y.s;
        }
        if ((b = (j = yc.length) - (i = xc.length)) > 0) for (; b--; ) xc[i++] = 0;
        for (b = i; j > a; ) {
          if (xc[--j] < yc[j]) {
            for (i = j; i && !xc[--i]; ) xc[i] = 9;
            --xc[i];
            xc[j] += 10;
          }
          xc[j] -= yc[j];
        }
        for (; xc[--b] === 0; ) xc.pop();
        for (; xc[0] === 0; ) {
          xc.shift();
          --ye;
        }
        if (!xc[0]) {
          y.s = 1;
          xc = [ye = 0];
        }
        y.c = xc;
        y.e = ye;
        return y;
      };
      P.mod = function(y) {
        var ygtx, x = this, Big2 = x.constructor, a = x.s, b = (y = new Big2(y)).s;
        if (!y.c[0]) {
          throw Error(DIV_BY_ZERO);
        }
        x.s = y.s = 1;
        ygtx = y.cmp(x) == 1;
        x.s = a;
        y.s = b;
        if (ygtx) return new Big2(x);
        a = Big2.DP;
        b = Big2.RM;
        Big2.DP = Big2.RM = 0;
        x = x.div(y);
        Big2.DP = a;
        Big2.RM = b;
        return this.minus(x.times(y));
      };
      P.neg = function() {
        var x = new this.constructor(this);
        x.s = -x.s;
        return x;
      };
      P.plus = P.add = function(y) {
        var e, k, t, x = this, Big2 = x.constructor;
        y = new Big2(y);
        if (x.s != y.s) {
          y.s = -y.s;
          return x.minus(y);
        }
        var xe = x.e, xc = x.c, ye = y.e, yc = y.c;
        if (!xc[0] || !yc[0]) {
          if (!yc[0]) {
            if (xc[0]) {
              y = new Big2(x);
            } else {
              y.s = x.s;
            }
          }
          return y;
        }
        xc = xc.slice();
        if (e = xe - ye) {
          if (e > 0) {
            ye = xe;
            t = yc;
          } else {
            e = -e;
            t = xc;
          }
          t.reverse();
          for (; e--; ) t.push(0);
          t.reverse();
        }
        if (xc.length - yc.length < 0) {
          t = yc;
          yc = xc;
          xc = t;
        }
        e = yc.length;
        for (k = 0; e; xc[e] %= 10) k = (xc[--e] = xc[e] + yc[e] + k) / 10 | 0;
        if (k) {
          xc.unshift(k);
          ++ye;
        }
        for (e = xc.length; xc[--e] === 0; ) xc.pop();
        y.c = xc;
        y.e = ye;
        return y;
      };
      P.pow = function(n) {
        var x = this, one = new x.constructor("1"), y = one, isneg = n < 0;
        if (n !== ~~n || n < -MAX_POWER || n > MAX_POWER) {
          throw Error(INVALID + "exponent");
        }
        if (isneg) n = -n;
        for (; ; ) {
          if (n & 1) y = y.times(x);
          n >>= 1;
          if (!n) break;
          x = x.times(x);
        }
        return isneg ? one.div(y) : y;
      };
      P.prec = function(sd, rm) {
        if (sd !== ~~sd || sd < 1 || sd > MAX_DP) {
          throw Error(INVALID + "precision");
        }
        return round(new this.constructor(this), sd, rm);
      };
      P.round = function(dp, rm) {
        if (dp === UNDEFINED) dp = 0;
        else if (dp !== ~~dp || dp < -MAX_DP || dp > MAX_DP) {
          throw Error(INVALID_DP);
        }
        return round(new this.constructor(this), dp + this.e + 1, rm);
      };
      P.sqrt = function() {
        var r, c, t, x = this, Big2 = x.constructor, s = x.s, e = x.e, half = new Big2("0.5");
        if (!x.c[0]) return new Big2(x);
        if (s < 0) {
          throw Error(NAME + "No square root");
        }
        s = Math.sqrt(+stringify(x, true, true));
        if (s === 0 || s === 1 / 0) {
          c = x.c.join("");
          if (!(c.length + e & 1)) c += "0";
          s = Math.sqrt(c);
          e = ((e + 1) / 2 | 0) - (e < 0 || e & 1);
          r = new Big2((s == 1 / 0 ? "5e" : (s = s.toExponential()).slice(0, s.indexOf("e") + 1)) + e);
        } else {
          r = new Big2(s + "");
        }
        e = r.e + (Big2.DP += 4);
        do {
          t = r;
          r = half.times(t.plus(x.div(t)));
        } while (t.c.slice(0, e).join("") !== r.c.slice(0, e).join(""));
        return round(r, (Big2.DP -= 4) + r.e + 1, Big2.RM);
      };
      P.times = P.mul = function(y) {
        var c, x = this, Big2 = x.constructor, xc = x.c, yc = (y = new Big2(y)).c, a = xc.length, b = yc.length, i = x.e, j = y.e;
        y.s = x.s == y.s ? 1 : -1;
        if (!xc[0] || !yc[0]) {
          y.c = [y.e = 0];
          return y;
        }
        y.e = i + j;
        if (a < b) {
          c = xc;
          xc = yc;
          yc = c;
          j = a;
          a = b;
          b = j;
        }
        for (c = new Array(j = a + b); j--; ) c[j] = 0;
        for (i = b; i--; ) {
          b = 0;
          for (j = a + i; j > i; ) {
            b = c[j] + yc[i] * xc[j - i - 1] + b;
            c[j--] = b % 10;
            b = b / 10 | 0;
          }
          c[j] = b;
        }
        if (b) ++y.e;
        else c.shift();
        for (i = c.length; !c[--i]; ) c.pop();
        y.c = c;
        return y;
      };
      P.toExponential = function(dp, rm) {
        var x = this, n = x.c[0];
        if (dp !== UNDEFINED) {
          if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
            throw Error(INVALID_DP);
          }
          x = round(new x.constructor(x), ++dp, rm);
          for (; x.c.length < dp; ) x.c.push(0);
        }
        return stringify(x, true, !!n);
      };
      P.toFixed = function(dp, rm) {
        var x = this, n = x.c[0];
        if (dp !== UNDEFINED) {
          if (dp !== ~~dp || dp < 0 || dp > MAX_DP) {
            throw Error(INVALID_DP);
          }
          x = round(new x.constructor(x), dp + x.e + 1, rm);
          for (dp = dp + x.e + 1; x.c.length < dp; ) x.c.push(0);
        }
        return stringify(x, false, !!n);
      };
      P.toJSON = P.toString = function() {
        var x = this, Big2 = x.constructor;
        return stringify(x, x.e <= Big2.NE || x.e >= Big2.PE, !!x.c[0]);
      };
      P.toNumber = function() {
        var n = +stringify(this, true, true);
        if (this.constructor.strict === true && !this.eq(n.toString())) {
          throw Error(NAME + "Imprecise conversion");
        }
        return n;
      };
      P.toPrecision = function(sd, rm) {
        var x = this, Big2 = x.constructor, n = x.c[0];
        if (sd !== UNDEFINED) {
          if (sd !== ~~sd || sd < 1 || sd > MAX_DP) {
            throw Error(INVALID + "precision");
          }
          x = round(new Big2(x), sd, rm);
          for (; x.c.length < sd; ) x.c.push(0);
        }
        return stringify(x, sd <= x.e || x.e <= Big2.NE || x.e >= Big2.PE, !!n);
      };
      P.valueOf = function() {
        var x = this, Big2 = x.constructor;
        if (Big2.strict === true) {
          throw Error(NAME + "valueOf disallowed");
        }
        return stringify(x, x.e <= Big2.NE || x.e >= Big2.PE, true);
      };
      Big = _Big_();
      Big["default"] = Big.Big = Big;
      if (typeof define === "function" && define.amd) {
        define(function() {
          return Big;
        });
      } else if (typeof module !== "undefined" && module.exports) {
        module.exports = Big;
      } else {
        GLOBAL.Big = Big;
      }
    })(exports);
  }
});

// scripts/roofing-metre/src/estimate.cjs
var require_estimate = __commonJS({
  "scripts/roofing-metre/src/estimate.cjs"(exports, module) {
    "use strict";
    var Big = require_big();
    var ceil = (x) => x.round(0, Big.roundUp);
    var sum = (xs) => xs.reduce((a, b) => a.plus(b), new Big("0"));
    function decimal(v, name, { min = "0", max = "1000000", strict = false } = {}) {
      if (typeof v !== "string" && typeof v !== "number" || !/^\d+(?:\.\d{1,5})?$/.test(String(v)))
        throw new Error(name + ": valeur d\xE9cimale positive attendue (point d\xE9cimal)");
      const x = new Big(String(v));
      if (x.lt(min) || x.gt(max) || strict && x.eq("0"))
        throw new Error(name + ": valeur hors limites");
      return x;
    }
    function required(obj, key, context, constraints) {
      if (!obj || !(key in obj)) throw new Error(context + "." + key + ": valeur requise");
      return decimal(obj[key], context + "." + key, constraints);
    }
    var fmt = (x, digits = 3) => x.toFixed(digits);
    function estimate2(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Objet projet requis");
      if (!Array.isArray(input.planes) || !input.planes.length || input.planes.length > 20)
        throw new Error("planes: de 1 \xE0 20 versants requis");
      const cfg = input.config;
      if (!cfg || typeof cfg !== "object") throw new Error("config requis: mesures de couverture et pertes explicites");
      const coverWidth = required(cfg, "usefulCoverWidthMm", "config", { min: "30", max: "1000", strict: true }).div(1e3);
      const exposure = required(cfg, "usefulExposureMm", "config", { min: "30", max: "1000", strict: true }).div(1e3);
      const battenGauge = required(cfg, "battenSpacingM", "config", { min: "0.05", max: "1", strict: true });
      const counterGauge = required(cfg, "counterBattenSpacingM", "config", { min: "0.2", max: "2", strict: true });
      const slateWaste = required(cfg, "slateWastePct", "config", { min: "0", max: "40" }).div(100);
      const underlayAllowance = required(cfg, "underlayAllowancePct", "config", { min: "0", max: "40" }).div(100);
      const timberWaste = required(cfg, "timberWastePct", "config", { min: "0", max: "40" }).div(100);
      const ids = /* @__PURE__ */ new Set();
      const roofs = input.planes.map((p, i) => {
        if (!p || typeof p !== "object" || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,50}$/.test(p.id) || ids.has(p.id))
          throw new Error("planes[" + i + "]: identifiant unique requis");
        ids.add(p.id);
        const eave = required(p, "eaveLengthM", p.id, { min: "0.1", max: "300", strict: true });
        const slope = required(p, "developedSlopeM", p.id, { min: "0.1", max: "200", strict: true });
        const gross = eave.times(slope);
        const openings = p.openingsM2 == null ? new Big(0) : decimal(p.openingsM2, p.id + ".openingsM2", { min: "0", max: "60000" });
        if (openings.gte(gross)) throw new Error(p.id + ": ouverture >= surface versant");
        const rows = ceil(slope.div(exposure));
        const columns = ceil(eave.div(coverWidth));
        const slateCount = ceil(rows.times(columns).times(new Big(1).plus(slateWaste)));
        const battenRows = ceil(slope.div(battenGauge)).plus(1);
        const counterRows = ceil(eave.div(counterGauge)).plus(1);
        return {
          id: p.id,
          areaGrossM2: fmt(gross),
          areaNetM2: fmt(gross.minus(openings)),
          openingsM2: fmt(openings),
          slateRows: Number(rows.toString()),
          slateColumns: Number(columns.toString()),
          slateQuantity: Number(slateCount.toString()),
          underlayM2: fmt(gross.times(new Big(1).plus(underlayAllowance))),
          battenLinearM: fmt(battenRows.times(eave).times(new Big(1).plus(timberWaste))),
          counterBattenLinearM: fmt(counterRows.times(slope).times(new Big(1).plus(timberWaste)))
        };
      });
      const measure = (key) => input[key] == null ? new Big(0) : decimal(input[key], key, { max: "30000" });
      const items = [
        { code: "SLATE_PIECES", unit: "pc", quantity: String(roofs.reduce((a, p) => a + p.slateQuantity, 0)) },
        { code: "UNDERLAY", unit: "m2", quantity: fmt(sum(roofs.map((p) => new Big(p.underlayM2)))) },
        { code: "BATTENS", unit: "m", quantity: fmt(sum(roofs.map((p) => new Big(p.battenLinearM)))) },
        { code: "COUNTER_BATTENS", unit: "m", quantity: fmt(sum(roofs.map((p) => new Big(p.counterBattenLinearM)))) },
        { code: "GUTTERS", unit: "m", quantity: fmt(measure("guttersM")) },
        { code: "FLASHINGS", unit: "m", quantity: fmt(measure("flashingsM")) }
      ];
      let total = new Big(0), pricesPresent = false;
      for (const row of items) {
        const price = input.unitPrices?.[row.code];
        if (price !== void 0) {
          const unitPrice = decimal(price, "unitPrices." + row.code, { min: "0", max: "100000" });
          row.unitPrice = unitPrice.toFixed(2);
          row.totalExVat = new Big(row.quantity).times(unitPrice).toFixed(2);
          total = total.plus(row.totalExVat);
          pricesPresent = true;
        }
      }
      return {
        schemaVersion: "1",
        projectId: String(input.projectId || "").slice(0, 100),
        currency: input.currency || "EUR",
        measurementBasis: "developed_slope_measured_not_horizontal_run",
        planes: roofs,
        areaGrossM2: fmt(sum(roofs.map((p) => new Big(p.areaGrossM2)))),
        areaNetM2: fmt(sum(roofs.map((p) => new Big(p.areaNetM2)))),
        items,
        pricingComplete: items.every((x) => x.unitPrice !== void 0),
        knownPricedSubtotalExVat: pricesPresent ? total.toFixed(2) : null,
        pricedTotalExVat: items.every((x) => x.unitPrice !== void 0) ? total.toFixed(2) : null,
        warnings: [
          "Simulation de quantit\xE9s et prix indicatifs; m\xE9tr\xE9s terrain, recouvrements, d\xE9coupes et prescriptions fabricant \xE0 valider.",
          "Ouvertures d\xE9duites de la surface nette, mais NON du nombre conservateur de pi\xE8ces de couverture.",
          "Aucun contr\xF4le de stabilit\xE9, vent, charges, \xE9chafaudage, s\xE9curit\xE9, amiante, norme ou pente minimale.",
          "Prix HTVA partiel si certaines lignes sans tarif. Aucun taux de TVA pr\xE9sum\xE9."
        ]
      };
    }
    module.exports = { estimate: estimate2 };
  }
});

// scripts/measurement-engine-entry.js
var import_estimate = __toESM(require_estimate(), 1);
var import_big = __toESM(require_big(), 1);
var export_Big = import_big.default;
var export_estimate = import_estimate.estimate;
export {
  export_Big as Big,
  export_estimate as estimate
};
