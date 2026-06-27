package org.snailtrail.safebox.domain

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 加密管理器：AES-256-GCM、PBKDF2、RSA-OAEP、恢复码生成。
 * 所有加密操作集中在此，不依赖 Android Context。
 */
@Singleton
class CryptoManager @Inject constructor() {

    companion object {
        private const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256"
        private const val PBKDF2_ITERATIONS = 100_000
        private const val PBKDF2_KEY_LENGTH = 256
        private const val SALT_LENGTH = 32

        private const val AES_ALGORITHM = "AES/GCM/NoPadding"
        private const val AES_KEY_LENGTH = 256
        private const val GCM_NONCE_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128

        private const val RSA_ALGORITHM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        private const val RSA_KEY_LENGTH = 4096
        private const val RSA_MAX_ENCRYPT_LENGTH = 470 // OAEP SHA-256 开销更大

        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val DEVICE_KEY_ALIAS = "safebox_device_key"

        // BIP39 词表 (前 2048 词中的常用词，用于 12 词恢复码)
        private val BIP39_WORDS = listOf(
            "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
            "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
            "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
            "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
            "advice", "aerobic", "affair", "afford", "afraid", "africa", "after", "again",
            "age", "agent", "agree", "ahead", "aim", "air", "airport", "aisle",
            "alarm", "album", "alcohol", "alert", "alien", "all", "alley", "allow",
            "almost", "alone", "alpha", "already", "also", "alter", "always", "amateur",
            "amazing", "among", "amount", "amused", "analyst", "anchor", "ancient", "anger",
            "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer",
            "antenna", "antique", "anxiety", "any", "apart", "apology", "appear", "apple",
            "approve", "april", "arch", "arctic", "area", "arena", "argue", "arm",
            "armed", "armor", "army", "around", "arrange", "arrest", "arrive", "arrow",
            "art", "artefact", "artist", "artwork", "ask", "aspect", "assault", "asset",
            "assist", "assume", "asthma", "athlete", "atom", "attack", "attend", "attitude",
            "attract", "auction", "audit", "august", "aunt", "author", "auto", "autumn",
            "average", "avocado", "avoid", "awake", "aware", "away", "awesome", "awful",
            "awkward", "axis", "baby", "bachelor", "bacon", "badge", "bag", "balance",
            "balcony", "ball", "bamboo", "banana", "banner", "bar", "barely", "bargain",
            "barrel", "base", "basic", "basket", "battle", "beach", "bean", "beauty",
            "because", "become", "beef", "before", "begin", "behave", "behind", "believe",
            "below", "belt", "bench", "benefit", "best", "betray", "better", "between",
            "beyond", "bicycle", "bid", "bike", "bind", "biology", "bird", "birth",
            "bitter", "black", "blade", "blame", "blanket", "blast", "bleak", "bless",
            "blind", "blood", "blossom", "blouse", "blue", "blur", "blush", "board",
            "boat", "body", "boil", "bomb", "bone", "bonus", "book", "boost",
            "border", "boring", "borrow", "boss", "bottom", "bounce", "box", "boy",
            "bracket", "brain", "brand", "brass", "brave", "bread", "breeze", "brick",
            "bridge", "brief", "bright", "bring", "brisk", "broccoli", "broken", "bronze",
            "broom", "brother", "brown", "brush", "bubble", "buddy", "budget", "buffalo",
            "build", "bulb", "bulk", "bullet", "bundle", "bunker", "burden", "burger",
            "burst", "bus", "business", "busy", "butter", "buyer", "buzz", "cabbage",
            "cabin", "cable", "cactus", "cage", "cake", "call", "calm", "camera",
            "camp", "can", "canal", "cancel", "candy", "cannon", "canoe", "canvas",
            "canyon", "capable", "capital", "captain", "car", "carbon", "card", "cargo",
            "carpet", "carry", "cart", "case", "cash", "casino", "castle", "casual",
            "cat", "catalog", "catch", "category", "cattle", "caught", "cause", "caution",
            "cave", "ceiling", "celery", "cement", "census", "century", "cereal", "certain",
            "chair", "chalk", "champion", "change", "chaos", "chapter", "charge", "chase",
            "chat", "cheap", "check", "cheese", "chef", "cherry", "chest", "chicken",
            "chief", "child", "chimney", "choice", "choose", "chronic", "chuckle", "chunk",
            "churn", "cigar", "cinnamon", "circle", "citizen", "city", "civil", "claim",
            "clap", "clarify", "claw", "clay", "clean", "clerk", "clever", "click",
            "client", "cliff", "climb", "clinic", "clip", "clock", "clog", "close",
            "cloth", "cloud", "clown", "club", "clump", "cluster", "clutch", "coach",
            "coast", "coconut", "code", "coffee", "coil", "coin", "collect", "color",
            "column", "combine", "come", "comfort", "comic", "common", "company", "concert",
            "conduct", "confirm", "congress", "connect", "consider", "control", "convince", "cook",
            "cool", "copper", "copy", "coral", "core", "corn", "correct", "cost",
            "cotton", "couch", "country", "couple", "course", "cousin", "cover", "coyote",
            "crack", "cradle", "craft", "cram", "crane", "crash", "crater", "crawl",
            "crazy", "cream", "credit", "creek", "crew", "cricket", "crime", "crisp",
            "critic", "crop", "cross", "crouch", "crowd", "crucial", "cruel", "cruise",
            "crumble", "crunch", "crush", "cry", "crystal", "cube", "culture", "cup",
            "cupboard", "curious", "current", "curtain", "curve", "cushion", "custom", "cute",
            "cycle", "dad", "damage", "damp", "dance", "danger", "daring", "dash",
            "daughter", "dawn", "day", "deal", "debate", "debris", "decade", "december",
            "decide", "decline", "decorate", "decrease", "deer", "defense", "define", "defy",
            "degree", "delay", "deliver", "demand", "demise", "denial", "dentist", "deny",
            "depart", "depend", "deposit", "depth", "deputy", "derive", "describe", "desert",
            "design", "desk", "despair", "destroy", "detail", "detect", "develop", "device",
            "devote", "diagram", "dial", "diamond", "diary", "dice", "diesel", "diet",
            "differ", "digital", "dignity", "dilemma", "dinner", "dinosaur", "direct", "dirt",
            "disagree", "discover", "disease", "dish", "dismiss", "disorder", "display", "distance",
            "divert", "divide", "divorce", "dizzy", "doctor", "document", "dog", "doll",
            "dolphin", "domain", "donate", "donkey", "donor", "door", "dose", "double",
            "dove", "draft", "dragon", "drama", "drastic", "draw", "dream", "dress",
            "drift", "drill", "drink", "drip", "drive", "drop", "drum", "dry",
            "duck", "dumb", "dune", "during", "dust", "dutch", "duty", "dwarf",
            "dynamic", "eager", "eagle", "early", "earn", "earth", "easily", "east",
            "easy", "echo", "ecology", "economy", "edge", "edit", "educate", "effort",
            "egg", "eight", "either", "elbow", "elder", "electric", "elegant", "element",
            "elephant", "elevator", "elite", "else", "embark", "embody", "embrace", "emerge",
            "emotion", "employ", "empower", "empty", "enable", "enact", "end", "endless",
            "endorse", "enemy", "energy", "enforce", "engage", "engine", "enhance", "enjoy",
            "enlist", "enough", "enrich", "enroll", "ensure", "enter", "entire", "entry",
            "envelope", "episode", "equal", "equip", "era", "erase", "erode", "erosion",
            "error", "erupt", "escape", "essay", "essence", "estate", "eternal", "ethics",
            "evidence", "evil", "evoke", "evolve", "exact", "example", "excess", "exchange",
            "excite", "exclude", "excuse", "execute", "exercise", "exhaust", "exhibit", "exile",
            "exist", "exit", "exotic", "expand", "expect", "expire", "explain", "expose",
            "express", "extend", "extra", "eye", "eyebrow", "fabric", "face", "faculty",
            "fade", "faint", "faith", "fall", "false", "fame", "family", "famous",
            "fan", "fancy", "fantasy", "farm", "fashion", "fat", "fatal", "father",
            "fatigue", "fault", "favorite", "feature", "february", "federal", "fee", "feed",
            "feel", "female", "fence", "festival", "fetch", "fever", "few", "fiber",
            "fiction", "field", "figure", "file", "film", "filter", "final", "find",
            "fine", "finger", "finish", "fire", "firm", "first", "fiscal", "fish",
            "fit", "fitness", "fix", "flag", "flame", "flash", "flat", "flavor",
            "flee", "flight", "flip", "float", "flock", "floor", "flower", "fluid",
            "flush", "fly", "foam", "focus", "fog", "foil", "fold", "follow",
            "food", "foot", "force", "forest", "forget", "fork", "fortune", "forum",
            "forward", "fossil", "foster", "found", "fox", "fragile", "frame", "frequent",
            "fresh", "friend", "fringe", "frog", "front", "frost", "frown", "frozen",
            "fruit", "fuel", "fun", "funny", "furnace", "fury", "future", "gadget",
            "gain", "galaxy", "gallery", "game", "gap", "garage", "garbage", "garden",
            "garlic", "garment", "gas", "gasp", "gate", "gather", "gauge", "gaze",
            "general", "genius", "genre", "gentle", "genuine", "gesture", "ghost", "giant",
            "gift", "giggle", "ginger", "giraffe", "girl", "give", "glad", "glance",
            "glare", "glass", "glide", "glimpse", "globe", "gloom", "glory", "glove",
            "glow", "glue", "goat", "goddess", "gold", "good", "goose", "gorilla",
            "gospel", "gossip", "govern", "gown", "grab", "grace", "grain", "grant",
            "grape", "grass", "gravity", "great", "green", "grid", "grief", "grit",
            "grocery", "group", "grow", "grunt", "guard", "guess", "guide", "guilt",
            "guitar", "gun", "gym", "habit", "hair", "half", "hammer", "hamster",
            "hand", "happy", "harbor", "hard", "harsh", "harvest", "hat", "have",
            "hawk", "hazard", "head", "health", "heart", "heavy", "hedgehog", "height",
            "hello", "helmet", "help", "hen", "hero", "hidden", "high", "hill",
            "hint", "hip", "hire", "history", "hobby", "hockey", "hold", "hole",
            "holiday", "hollow", "home", "honey", "hood", "hope", "horn", "horror",
            "horse", "hospital", "host", "hotel", "hour", "hover", "hub", "huge",
            "human", "humble", "humor", "hundred", "hunt", "hurdle", "hurry", "hurt",
            "husband", "hybrid", "ice", "icon", "idea", "identify", "idle", "ignore",
            "ill", "illegal", "illness", "image", "imitate", "immense", "immune", "impact",
            "impose", "improve", "impulse", "inch", "include", "income", "increase", "index",
            "indicate", "indoor", "industry", "infant", "inflict", "inform", "inhale", "inherit",
            "initial", "inject", "injury", "inmate", "inner", "innocent", "input", "inquiry",
            "insane", "insect", "inside", "inspire", "install", "intact", "interest", "into",
            "invest", "invite", "involve", "iron", "island", "isolate", "issue", "item",
            "ivory", "jacket", "jaguar", "jar", "jazz", "jealous", "jeans", "jelly",
            "jewel", "job", "join", "joke", "journey", "joy", "judge", "juice",
            "jump", "jungle", "junior", "junk", "just", "kangaroo", "keen", "keep",
            "ketchup", "key", "kick", "kid", "kidney", "kind", "kingdom", "kiss",
            "kit", "kitchen", "kite", "kitten", "kiwi", "knee", "knife", "knock",
            "know", "lab", "label", "labor", "ladder", "lady", "lake", "lamp",
            "language", "laptop", "large", "later", "latin", "laugh", "laundry", "lava",
            "law", "lawn", "lawsuit", "layer", "lazy", "leader", "leaf", "learn",
            "leave", "lecture", "left", "leg", "legal", "legend", "leisure", "lemon",
            "lend", "length", "lens", "leopard", "lesson", "letter", "level", "liar",
            "liberty", "library", "license", "life", "lift", "light", "like", "limb",
            "limit", "link", "lion", "liquid", "list", "little", "live", "lizard",
            "load", "loan", "lobster", "local", "lock", "logic", "lonely", "long",
            "loop", "lottery", "loud", "lounge", "love", "loyal", "lucky", "luggage",
            "lumber", "lunar", "lunch", "luxury", "lyrics", "machine", "mad", "magic",
            "magnet", "maid", "mail", "main", "major", "make", "mammal", "man",
            "manage", "mandate", "mango", "mansion", "manual", "maple", "marble", "march",
            "margin", "marine", "market", "marriage", "mask", "mass", "master", "match",
            "material", "math", "matrix", "matter", "maximum", "maze", "meadow", "mean",
            "measure", "meat", "mechanic", "medal", "media", "melody", "melt", "member",
            "memory", "mention", "menu", "mercy", "merge", "merit", "merry", "mesh",
            "message", "metal", "method", "middle", "midnight", "milk", "million", "mimic",
            "mind", "minimum", "minor", "minute", "miracle", "mirror", "misery", "miss",
            "mistake", "mix", "mixed", "mixture", "mobile", "model", "modify", "mom",
            "moment", "monitor", "monkey", "monster", "month", "moon", "moral", "more",
            "morning", "mosquito", "mother", "motion", "motor", "mountain", "mouse", "move",
            "movie", "much", "muffin", "mule", "multiply", "muscle", "museum", "mushroom",
            "music", "must", "mutual", "myself", "mystery", "myth", "naive", "name",
            "napkin", "narrow", "nasty", "nation", "nature", "near", "neck", "need",
            "negative", "neglect", "neither", "nephew", "nerve", "nest", "net", "network",
            "neutral", "never", "news", "next", "nice", "night", "noble", "noise",
            "nominee", "noodle", "normal", "north", "nose", "notable", "note", "nothing",
            "notice", "novel", "now", "nuclear", "number", "nurse", "nut", "oak",
            "obey", "object", "oblige", "obscure", "observe", "obtain", "obvious", "occur",
            "ocean", "october", "odor", "off", "offer", "office", "often", "oil",
            "okay", "old", "olive", "olympic", "omit", "once", "one", "onion",
            "online", "only", "open", "opera", "opinion", "oppose", "option", "orange",
            "orbit", "orchard", "order", "ordinary", "organ", "orient", "original", "orphan",
            "ostrich", "other", "outdoor", "outer", "output", "outside", "oval", "oven",
            "over", "own", "owner", "oxygen", "oyster", "ozone", "pact", "paddle",
            "page", "pair", "palace", "palm", "panda", "panel", "panic", "panther",
            "paper", "parade", "parent", "park", "parrot", "party", "pass", "patch",
            "path", "patient", "patrol", "pattern", "pause", "pave", "payment", "peace",
            "peanut", "pear", "peasant", "pelican", "pen", "penalty", "pencil", "people",
            "pepper", "perfect", "permit", "person", "pet", "phone", "photo", "phrase",
            "physical", "piano", "picnic", "picture", "piece", "pig", "pigeon", "pill",
            "pilot", "pink", "pioneer", "pipe", "pistol", "pitch", "pizza", "place",
            "planet", "plastic", "plate", "play", "please", "pledge", "pluck", "plug",
            "plunge", "poem", "poet", "point", "polar", "pole", "police", "pond",
            "pony", "pool", "popular", "portion", "position", "possible", "post", "potato",
            "pottery", "poverty", "powder", "power", "practice", "praise", "predict", "prefer",
            "prepare", "present", "pretty", "prevent", "price", "pride", "primary", "print",
            "priority", "prison", "private", "prize", "problem", "process", "produce", "profit",
            "program", "project", "promote", "proof", "property", "prosper", "protect", "proud",
            "provide", "public", "pudding", "pull", "pulp", "pulse", "pumpkin", "punch",
            "pupil", "puppy", "purchase", "purity", "purpose", "purse", "push", "put",
            "puzzle", "pyramid", "quality", "quantum", "quarter", "question", "quick", "quit",
            "quiz", "quote", "rabbit", "raccoon", "race", "rack", "radar", "radio",
            "rail", "rain", "raise", "rally", "ramp", "ranch", "random", "range",
            "rapid", "rare", "rate", "rather", "raven", "raw", "razor", "ready",
            "real", "reason", "rebel", "rebuild", "recall", "receive", "recipe", "record",
            "recycle", "reduce", "reflect", "reform", "refuse", "region", "regret", "regular",
            "reject", "relax", "release", "relief", "rely", "remain", "remember", "remind",
            "remove", "render", "renew", "rent", "reopen", "repair", "repeat", "replace",
            "report", "require", "rescue", "resemble", "resist", "resource", "response", "result",
            "retire", "retreat", "return", "reunion", "reveal", "review", "reward", "rhythm",
            "rib", "ribbon", "rice", "rich", "ride", "ridge", "rifle", "right",
            "rigid", "ring", "riot", "ripple", "risk", "ritual", "rival", "river",
            "road", "roast", "robot", "robust", "rocket", "romance", "roof", "rookie",
            "room", "rose", "rotate", "rough", "round", "route", "royal", "rubber",
            "rude", "rug", "rule", "run", "runway", "rural", "sad", "saddle",
            "sadness", "safe", "sail", "salad", "salmon", "salon", "salt", "salute",
            "same", "sample", "sand", "satisfy", "satoshi", "sauce", "sausage", "save",
            "say", "scale", "scan", "scare", "scatter", "scene", "scheme", "school",
            "science", "scissors", "scorpion", "scout", "scrap", "screen", "script", "scrub",
            "sea", "search", "season", "seat", "second", "secret", "section", "security",
            "seed", "seek", "segment", "select", "sell", "seminar", "senior", "sense",
            "sentence", "series", "service", "session", "settle", "setup", "seven", "shadow",
            "shaft", "shallow", "share", "shed", "shell", "sheriff", "shield", "shift",
            "shine", "ship", "shiver", "shock", "shoe", "shoot", "shop", "short",
            "shoulder", "shove", "shrimp", "shrug", "shuffle", "shy", "sibling", "sick",
            "side", "siege", "sight", "sign", "silent", "silk", "silly", "silver",
            "similar", "simple", "since", "sing", "siren", "sister", "situate", "six",
            "size", "skate", "sketch", "ski", "skill", "skin", "skirt", "skull",
            "slab", "slam", "sleep", "slender", "slice", "slide", "slight", "slim",
            "slogan", "slot", "slow", "slush", "small", "smart", "smile", "smoke",
            "smooth", "snack", "snake", "snap", "sniff", "snow", "soap", "soccer",
            "social", "sock", "soda", "soft", "solar", "soldier", "solid", "solution",
            "solve", "someone", "song", "soon", "sorry", "sort", "soul", "sound",
            "soup", "source", "south", "space", "spare", "spatial", "spawn", "speak",
            "special", "speed", "spell", "spend", "sphere", "spice", "spider", "spike",
            "spin", "spirit", "split", "spoil", "sponsor", "spoon", "sport", "spot",
            "spray", "spread", "spring", "spy", "square", "squeeze", "squirrel", "stable",
            "stadium", "staff", "stage", "stairs", "stamp", "stand", "start", "state",
            "stay", "steak", "steel", "stem", "step", "stereo", "stick", "still",
            "sting", "stock", "stomach", "stone", "stool", "story", "stove", "strategy",
            "street", "strike", "strong", "struggle", "student", "stuff", "stumble", "style",
            "subject", "submit", "subway", "success", "such", "sudden", "suffer", "sugar",
            "suggest", "suit", "summer", "sun", "sunny", "sunset", "super", "supply",
            "supreme", "sure", "surface", "surge", "surprise", "surround", "survey", "suspect",
            "sustain", "swallow", "swamp", "swap", "swarm", "swear", "sweet", "swift",
            "swim", "swing", "switch", "sword", "symbol", "symptom", "syrup", "system",
            "table", "tackle", "tag", "tail", "talent", "talk", "tank", "tape",
            "target", "task", "taste", "tattoo", "taxi", "teach", "team", "tell",
            "ten", "tenant", "tennis", "tent", "term", "test", "text", "thank",
            "that", "theme", "then", "theory", "there", "they", "thing", "this",
            "thought", "three", "thrive", "throw", "thumb", "thunder", "ticket", "tide",
            "tiger", "tilt", "timber", "time", "tiny", "tip", "tired", "tissue",
            "title", "toast", "tobacco", "today", "toddler", "toe", "together", "toilet",
            "token", "tomato", "tomorrow", "tone", "tongue", "tonight", "tool", "tooth",
            "top", "topic", "topple", "torch", "tornado", "tortoise", "toss", "total",
            "tourist", "toward", "tower", "town", "toy", "track", "trade", "traffic",
            "tragic", "train", "transfer", "trap", "trash", "travel", "tray", "treat",
            "tree", "trend", "trial", "tribe", "trick", "trigger", "trim", "trip",
            "trophy", "trouble", "truck", "true", "truly", "trumpet", "trust", "truth",
            "try", "tube", "tuition", "tumble", "tuna", "tunnel", "turkey", "turn",
            "turtle", "twelve", "twenty", "twice", "twin", "twist", "two", "type",
            "typical", "ugly", "umbrella", "unable", "unaware", "uncle", "uncover", "under",
            "undo", "unfair", "unfold", "unhappy", "uniform", "unique", "unit", "universe",
            "unknown", "unlock", "until", "unusual", "unveil", "update", "upgrade", "uphold",
            "upon", "upper", "upset", "urban", "urge", "usage", "use", "used",
            "useful", "useless", "usual", "utility", "vacant", "vacuum", "vague", "valid",
            "valley", "valve", "van", "vanish", "vapor", "various", "vast", "vault",
            "vehicle", "velvet", "vendor", "venture", "venue", "verb", "verify", "version",
            "very", "vessel", "veteran", "viable", "vibrant", "vicious", "victory", "video",
            "view", "village", "vintage", "violin", "virtual", "virus", "visa", "visit",
            "visual", "vital", "vivid", "vocal", "voice", "void", "volcano", "volume",
            "vote", "voyage", "wage", "wagon", "wait", "walk", "wall", "walnut",
            "want", "warfare", "warm", "warrior", "wash", "wasp", "waste", "water",
            "wave", "way", "wealth", "weapon", "wear", "weasel", "weather", "web",
            "wedding", "weekend", "weird", "welcome", "west", "wet", "whale", "what",
            "wheat", "wheel", "when", "where", "whip", "whisper", "wide", "width",
            "wife", "wild", "will", "win", "window", "wine", "wing", "wink",
            "winner", "winter", "wire", "wisdom", "wise", "wish", "witness", "wolf",
            "woman", "wonder", "wood", "wool", "word", "work", "world", "worry",
            "worth", "wrap", "wreck", "wrestle", "wrist", "write", "wrong", "yard",
            "year", "yellow", "you", "young", "youth", "zebra", "zero", "zone", "zoo"
        )
    }

    // ── PBKDF2 ────────────────────────────────────

    fun generateSalt(): ByteArray {
        val salt = ByteArray(SALT_LENGTH)
        SecureRandom().nextBytes(salt)
        return salt
    }

    fun deriveKey(password: String, salt: ByteArray): SecretKey {
        val spec = PBEKeySpec(password.toCharArray(), salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM)
        val keyBytes = factory.generateSecret(spec).encoded
        return SecretKeySpec(keyBytes, "AES")
    }

    // ── AES-256-GCM ───────────────────────────────

    fun aesEncrypt(key: SecretKey, plaintext: ByteArray): String {
        val cipher = Cipher.getInstance(AES_ALGORITHM)
        val nonce = ByteArray(GCM_NONCE_LENGTH)
        SecureRandom().nextBytes(nonce)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, nonce))
        val ciphertext = cipher.doFinal(plaintext)
        // nonce (12) + ciphertext (n)
        val result = nonce + ciphertext
        return android.util.Base64.encodeToString(result, android.util.Base64.NO_WRAP)
    }

    fun aesDecrypt(key: SecretKey, encoded: String): ByteArray? {
        return try {
            val data = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
            val nonce = data.copyOfRange(0, GCM_NONCE_LENGTH)
            val ciphertext = data.copyOfRange(GCM_NONCE_LENGTH, data.size)
            val cipher = Cipher.getInstance(AES_ALGORITHM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, nonce))
            cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            null
        }
    }

    fun aesEncryptString(key: SecretKey, plaintext: String): String {
        return aesEncrypt(key, plaintext.toByteArray(Charsets.UTF_8))
    }

    fun aesDecryptString(key: SecretKey, encoded: String): String? {
        val bytes = aesDecrypt(key, encoded) ?: return null
        return String(bytes, Charsets.UTF_8)
    }

    // ── Master Key ─────────────────────────────────

    fun generateMasterKey(): SecretKey {
        val keyBytes = ByteArray(AES_KEY_LENGTH / 8)
        SecureRandom().nextBytes(keyBytes)
        return SecretKeySpec(keyBytes, "AES")
    }

    // ── RSA-4096 OAEP ──────────────────────────────

    fun generateRsaKeyPair(): Pair<PublicKey, PrivateKey> {
        val generator = KeyPairGenerator.getInstance("RSA")
        generator.initialize(RSA_KEY_LENGTH, SecureRandom())
        val pair = generator.generateKeyPair()
        return Pair(pair.public, pair.private)
    }

    fun encodePublicKey(key: PublicKey): String {
        return android.util.Base64.encodeToString(key.encoded, android.util.Base64.NO_WRAP)
    }

    fun encodePrivateKey(key: PrivateKey): String {
        return android.util.Base64.encodeToString(key.encoded, android.util.Base64.NO_WRAP)
    }

    fun decodePublicKey(encoded: String): PublicKey? {
        return try {
            val bytes = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
            val keySpec = java.security.spec.X509EncodedKeySpec(bytes)
            val factory = java.security.KeyFactory.getInstance("RSA")
            factory.generatePublic(keySpec)
        } catch (e: Exception) {
            null
        }
    }

    fun decodePrivateKey(encoded: String): PrivateKey? {
        return try {
            val bytes = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
            val keySpec = java.security.spec.PKCS8EncodedKeySpec(bytes)
            val factory = java.security.KeyFactory.getInstance("RSA")
            factory.generatePrivate(keySpec)
        } catch (e: Exception) {
            null
        }
    }

    fun rsaEncrypt(publicKey: PublicKey, plaintext: String): String? {
        return try {
            val cipher = Cipher.getInstance(RSA_ALGORITHM)
            cipher.init(Cipher.ENCRYPT_MODE, publicKey)
            val data = plaintext.toByteArray(Charsets.UTF_8)
            // 分段加密
            val output = java.io.ByteArrayOutputStream()
            var offset = 0
            while (offset < data.size) {
                val chunkSize = minOf(RSA_MAX_ENCRYPT_LENGTH, data.size - offset)
                val chunk = cipher.doFinal(data, offset, chunkSize)
                output.write(chunk)
                offset += RSA_MAX_ENCRYPT_LENGTH
            }
            android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
    }

    fun rsaDecrypt(privateKey: PrivateKey, encoded: String): String? {
        return try {
            val cipher = Cipher.getInstance(RSA_ALGORITHM)
            cipher.init(Cipher.DECRYPT_MODE, privateKey)
            val data = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
            // 分段解密 (512 字节每段)
            val chunkSize = 512
            val output = java.io.ByteArrayOutputStream()
            var offset = 0
            while (offset < data.size) {
                val len = minOf(chunkSize, data.size - offset)
                val chunk = cipher.doFinal(data, offset, len)
                output.write(chunk)
                offset += chunkSize
            }
            String(output.toByteArray(), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    // ── 恢复码 (BIP39 12 词) ────────────────────────

    fun generateRecoveryCode(): String {
        val words = mutableListOf<String>()
        val entropy = ByteArray(16) // 128 bits → 12 words
        SecureRandom().nextBytes(entropy)
        // 简化版：直接随机选 12 个词（非标准 BIP39 但足够安全）
        repeat(12) {
            val index = (entropy[it].toInt() and 0xFF) % BIP39_WORDS.size
            words.add(BIP39_WORDS[index])
        }
        return words.joinToString(" ")
    }

    fun recoveryCodeToKey(recoveryCode: String): SecretKey {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(recoveryCode.trim().lowercase().toByteArray(Charsets.UTF_8))
        return SecretKeySpec(hash, "AES")
    }

    // ── Android Keystore ───────────────────────────

    fun generateDeviceKeyPair() {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        if (keyStore.containsAlias(DEVICE_KEY_ALIAS)) return

        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA, ANDROID_KEYSTORE
        )
        generator.initialize(
            KeyGenParameterSpec.Builder(
                DEVICE_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(2048)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
        )
        generator.generateKeyPair()
    }

    fun getDevicePublicKey(): PublicKey? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val entry = keyStore.getEntry(DEVICE_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        return entry?.certificate?.publicKey
    }

    fun getDevicePrivateKey(): PrivateKey? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val entry = keyStore.getEntry(DEVICE_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        return entry?.privateKey
    }

    fun deviceEncrypt(publicKey: PublicKey, plaintext: ByteArray): String? {
        return try {
            val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
            cipher.init(Cipher.ENCRYPT_MODE, publicKey)
            android.util.Base64.encodeToString(cipher.doFinal(plaintext), android.util.Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
    }

    fun deviceDecrypt(privateKey: PrivateKey, encoded: String): ByteArray? {
        return try {
            val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
            cipher.init(Cipher.DECRYPT_MODE, privateKey)
            cipher.doFinal(android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP))
        } catch (e: Exception) {
            null
        }
    }
}
