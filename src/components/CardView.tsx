import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SuitKey, cardRankLabel, isJoker, SUITS } from '../game/bisca';

type CardViewProps = {
  card?: Card;
  hidden?: boolean;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  label?: string;
  onPress?: () => void;
};

const ACE_MOTTOS: Record<SuitKey, string> = {
  DIAMONDS: 'NON VAL SAPER',
  HEARTS: 'PER UN PUNTO',
  CLUBS: 'CUOR TI MANCA',
  SPADES: 'TUO DANNO',
};

const PIP_ROWS: Record<number, number[]> = {
  2: [1, 1],
  3: [1, 1, 1],
  4: [2, 2],
  5: [2, 1, 2],
  6: [2, 2, 2],
  7: [2, 2, 1, 2],
};

export function CardView({ card, hidden, disabled, selected, compact, label, onPress }: CardViewProps) {
  const content = hidden || !card ? null : (
    <>
      <View style={styles.innerBorder} />
      <Corner card={card} compact={compact} />

      <View style={[styles.artArea, compact && styles.artAreaCompact]}>
        {card.value >= 8 ? <FigureArt card={card} compact={compact} /> : <PipLayout card={card} compact={compact} />}
      </View>

      <View style={styles.footer}>
        {isJoker(card) ? <Text style={[styles.joker, compact && styles.jokerCompact]}>Matta</Text> : null}
        {label ? <Text style={styles.note}>{label}</Text> : null}
      </View>

      <Corner card={card} compact={compact} bottom />
    </>
  );

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        hidden && styles.hidden,
        selected && styles.selected,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {hidden || !card ? <CardBack compact={compact} /> : content}
    </Pressable>
  );
}

function Corner({ card, bottom, compact }: { card: Card; bottom?: boolean; compact?: boolean }) {
  return (
    <View style={[styles.corner, bottom && styles.cornerBottom]}>
      <Text style={[styles.value, compact && styles.valueCompact, { color: SUITS[card.suit].color }]}>
        {cardRankLabel(card)}
      </Text>
      <Text style={[styles.cornerSuit, compact && styles.cornerSuitCompact, { color: SUITS[card.suit].color }]}>
        {SUITS[card.suit].shortLabel}
      </Text>
    </View>
  );
}

function CardBack({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.backPattern}>
      <View style={styles.backRail} />
      <View style={[styles.backDiamond, compact && styles.backDiamondCompact]} />
      <Text style={[styles.backText, compact && styles.backTextCompact]}>BISCA</Text>
      <View style={[styles.backDiamond, compact && styles.backDiamondCompact]} />
      <View style={styles.backRail} />
    </View>
  );
}

function PipLayout({ card, compact }: { card: Card; compact?: boolean }) {
  if (card.value === 1) {
    return <AceArt card={card} compact={compact} />;
  }

  const rows = PIP_ROWS[card.value] ?? [1];

  return (
    <View style={[styles.pipPanel, compact && styles.pipPanelCompact]}>
      {rows.map((count, rowIndex) => (
        <View key={`${card.value}-${rowIndex}`} style={styles.pipRow}>
          {Array.from({ length: count }, (_, index) => (
            <SuitMark key={index} suit={card.suit} compact={compact} />
          ))}
        </View>
      ))}
    </View>
  );
}

function AceArt({ card, compact }: { card: Card; compact?: boolean }) {
  return (
    <View style={[styles.acePanel, { borderColor: SUITS[card.suit].color }]}>
      <Text style={[styles.aceMotto, compact && styles.aceMottoCompact]}>{ACE_MOTTOS[card.suit]}</Text>
      <SuitMark suit={card.suit} compact={compact} large />
      <View style={[styles.aceRibbon, { backgroundColor: SUITS[card.suit].color }]} />
    </View>
  );
}

function FigureArt({ card, compact }: { card: Card; compact?: boolean }) {
  const figureName = card.value === 8 ? 'FANTE' : card.value === 9 ? 'CAVALLO' : 'RE';

  return (
    <View style={[styles.figureFrame, { borderColor: SUITS[card.suit].color }]}>
      <FigureHalf card={card} compact={compact} figureName={figureName} />
      <View style={[styles.figureDivider, { backgroundColor: SUITS[card.suit].color }]} />
      <View style={styles.figureMirror}>
        <FigureHalf card={card} compact={compact} figureName={figureName} />
      </View>
    </View>
  );
}

function FigureHalf({ card, compact, figureName }: { card: Card; compact?: boolean; figureName: string }) {
  return (
    <View style={styles.figureHalf}>
      <View style={[styles.figureHead, { backgroundColor: card.value === 10 ? '#facc15' : '#fee2b8' }]}>
        {card.value === 10 ? <View style={styles.crown} /> : null}
      </View>
      <View style={[styles.figureBody, { borderColor: SUITS[card.suit].color }]}>
        <SuitMark suit={card.suit} compact={compact} />
      </View>
      <Text style={[styles.figureText, compact && styles.figureTextCompact, { color: SUITS[card.suit].color }]}>
        {figureName}
      </Text>
    </View>
  );
}

function SuitMark({ suit, compact, large }: { suit: SuitKey; compact?: boolean; large?: boolean }) {
  const sizeStyle = large ? styles.markLarge : compact ? styles.markCompact : null;

  if (suit === 'DIAMONDS') {
    return (
      <View style={[styles.markWrap, sizeStyle]}>
        <View style={styles.coin}>
          <View style={styles.coinBlue} />
          <View style={styles.coinGold} />
          <View style={styles.coinCore} />
        </View>
      </View>
    );
  }

  if (suit === 'HEARTS') {
    return (
      <View style={[styles.markWrap, sizeStyle]}>
        <View style={styles.cup}>
          <View style={styles.cupLip} />
          <View style={styles.cupBowl} />
          <View style={styles.cupStem} />
          <View style={styles.cupBase} />
        </View>
      </View>
    );
  }

  if (suit === 'CLUBS') {
    return (
      <View style={[styles.markWrap, sizeStyle]}>
        <View style={styles.crossed}>
          <View style={[styles.blade, styles.bladeLeft]} />
          <View style={[styles.blade, styles.bladeRight]} />
          <View style={styles.hilt} />
          <View style={styles.flowerDot} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.markWrap, sizeStyle]}>
      <View style={styles.crossed}>
        <View style={[styles.baton, styles.bladeLeft]} />
        <View style={[styles.baton, styles.bladeRight]} />
        <View style={styles.knot} />
        <View style={styles.knotSmall} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 58,
    height: 122,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#7f1d1d',
    backgroundColor: '#fff4d4',
    padding: 5,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardCompact: {
    width: 42,
    height: 88,
    padding: 4,
    borderRadius: 7,
  },
  innerBorder: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    borderWidth: 1,
    borderColor: '#d97706',
    borderRadius: 5,
  },
  hidden: {
    backgroundColor: '#7f1d1d',
    borderColor: '#facc15',
  },
  selected: {
    borderColor: '#2563eb',
    borderWidth: 2,
    transform: [{ translateY: -6 }],
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    transform: [{ translateY: -4 }],
  },
  corner: {
    minHeight: 22,
    alignItems: 'flex-start',
    zIndex: 2,
  },
  cornerBottom: {
    alignSelf: 'flex-end',
    transform: [{ rotate: '180deg' }],
  },
  value: {
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 18,
  },
  valueCompact: {
    fontSize: 13,
    lineHeight: 13,
  },
  cornerSuit: {
    fontSize: 6,
    fontWeight: '900',
  },
  cornerSuitCompact: {
    fontSize: 5,
  },
  artArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  artAreaCompact: {
    marginVertical: -2,
  },
  pipPanel: {
    width: '100%',
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pipPanelCompact: {
    minHeight: 42,
    gap: 1,
  },
  pipRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  acePanel: {
    width: '92%',
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2b8',
    gap: 3,
  },
  aceMotto: {
    color: '#7c2d12',
    fontSize: 6,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  aceMottoCompact: {
    fontSize: 4,
  },
  aceRibbon: {
    width: '70%',
    height: 3,
    borderRadius: 2,
  },
  markWrap: {
    width: 18,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCompact: {
    transform: [{ scale: 0.66 }],
    marginHorizontal: -3,
    marginVertical: -4,
  },
  markLarge: {
    transform: [{ scale: 1.42 }],
    marginVertical: 8,
  },
  coin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#7c2d12',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  coinBlue: {
    flex: 1,
    backgroundColor: '#2563eb',
  },
  coinGold: {
    flex: 1,
    backgroundColor: '#facc15',
  },
  coinCore: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#92400e',
  },
  cup: {
    width: 18,
    height: 23,
    alignItems: 'center',
  },
  cupLip: {
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#facc15',
  },
  cupBowl: {
    width: 17,
    height: 11,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#dc2626',
  },
  cupStem: {
    width: 4,
    height: 6,
    backgroundColor: '#7f1d1d',
  },
  cupBase: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#7f1d1d',
  },
  crossed: {
    width: 22,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blade: {
    position: 'absolute',
    width: 4,
    height: 27,
    borderRadius: 3,
    backgroundColor: '#1d4ed8',
    borderWidth: 1,
    borderColor: '#111827',
  },
  baton: {
    position: 'absolute',
    width: 6,
    height: 26,
    borderRadius: 4,
    backgroundColor: '#92400e',
    borderWidth: 1,
    borderColor: '#451a03',
  },
  bladeLeft: {
    transform: [{ rotate: '-34deg' }],
  },
  bladeRight: {
    transform: [{ rotate: '34deg' }],
  },
  hilt: {
    width: 15,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#facc15',
  },
  flowerDot: {
    position: 'absolute',
    top: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  knot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7c2d12',
    backgroundColor: '#d97706',
  },
  knotSmall: {
    position: 'absolute',
    bottom: 4,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#facc15',
  },
  figureFrame: {
    width: '94%',
    minHeight: 66,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2b8',
    overflow: 'hidden',
  },
  figureHalf: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  figureMirror: {
    transform: [{ rotate: '180deg' }],
  },
  figureDivider: {
    width: '100%',
    height: 2,
  },
  figureHead: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7c2d12',
    alignItems: 'center',
  },
  crown: {
    marginTop: -4,
    width: 12,
    height: 5,
    borderRadius: 2,
    backgroundColor: '#facc15',
    borderWidth: 1,
    borderColor: '#92400e',
  },
  figureBody: {
    minWidth: 20,
    minHeight: 15,
    borderWidth: 1,
    borderRadius: 4,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  figureText: {
    fontSize: 7,
    fontWeight: '900',
  },
  figureTextCompact: {
    fontSize: 5,
  },
  footer: {
    minHeight: 14,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  joker: {
    color: '#7c2d12',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  jokerCompact: {
    fontSize: 6,
  },
  note: {
    color: '#4b5563',
    fontSize: 9,
    fontWeight: '700',
  },
  backPattern: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#facc15',
    backgroundColor: '#991b1b',
  },
  backRail: {
    width: '70%',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#facc15',
  },
  backDiamond: {
    width: 14,
    height: 14,
    backgroundColor: '#facc15',
    transform: [{ rotate: '45deg' }],
  },
  backDiamondCompact: {
    width: 10,
    height: 10,
  },
  backText: {
    color: '#fef3c7',
    fontSize: 11,
    fontWeight: '900',
  },
  backTextCompact: {
    fontSize: 8,
  },
});
