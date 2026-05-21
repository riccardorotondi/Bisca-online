from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict
from enum import Enum
import copy
from collections import defaultdict

class Suit(Enum):
    DIAMONDS = ("♦", 4)  # Quadri - più forte
    HEARTS = ("♥", 3)    # Cuori
    CLUBS = ("♣", 2)     # Fiori
    SPADES = ("♠", 1)    # Picche - più debole
    
    def __init__(self, symbol, strength):
        self.symbol = symbol
        self.strength = strength
    
    def __str__(self):
        return self.symbol

@dataclass
class Card:
    value: int  # 1-10 (A, 2-7, J=8, Q=9, K=10)
    suit: Suit
    
    def __str__(self):
        values = {1: "A", 8: "J", 9: "Q", 10: "K"}
        v = values.get(self.value, str(self.value))
        return f"{v}{self.suit}"
    
    def is_joker(self) -> bool:
        """L'asso di quadri è il jolly"""
        return self.value == 1 and self.suit == Suit.DIAMONDS
    
    def get_strength(self, as_zero: bool = False) -> int:
        """Calcola la forza della carta"""
        if self.is_joker():
            return 0 if as_zero else 1000  # Valore massimo o minimo
        
        # Formula: suit_strength * 100 + card_value
        return self.suit.strength * 100 + self.value

class Player:
    def __init__(self, player_id: int, cards: List[Card]):
        self.id = player_id
        self.cards = cards
        self.bid = 0  # Numero di mani dichiarate
        self.tricks_won = 0  # Mani vinte
    
    def has_card(self, card: Card) -> bool:
        return card in self.cards
    
    def play_card(self, card: Card):
        self.cards.remove(card)
    
    def win_trick(self):
        self.tricks_won += 1

class GameState:
    def __init__(self, players: List[Player], current_player: int = 0):
        self.players = players
        self.current_player = current_player
        self.trick_cards = []  # Carte giocate nel trick corrente
        self.trick_starter = current_player
        self.round_number = 1
        self.history = []
    
    def copy(self) -> 'GameState':
        """Crea una copia profonda dello stato"""
        new_players = []
        for p in self.players:
            new_p = Player(p.id, p.cards.copy())
            new_p.bid = p.bid
            new_p.tricks_won = p.tricks_won
            new_players.append(new_p)
        
        new_state = GameState(new_players, self.current_player)
        new_state.trick_cards = self.trick_cards.copy()
        new_state.trick_starter = self.trick_starter
        new_state.round_number = self.round_number
        new_state.history = self.history.copy()
        
        return new_state
    
    def get_valid_moves(self, player_id: int) -> List[Tuple[Card, bool]]:
        """Ritorna le mosse valide per un giocatore"""
        player = self.players[player_id]
        moves = []
        
        for card in player.cards:
            if card.is_joker():
                # Il jolly può essere giocato come 0 o come carta massima
                moves.append((card, True))   # Come carta massima
                moves.append((card, False))  # Come 0
            else:
                moves.append((card, False))  # as_zero non ha effetto per carte normali
        
        return moves
    
    def play_card(self, player_id: int, card: Card, as_zero: bool = False):
        """Gioca una carta"""
        player = self.players[player_id]
        player.play_card(card)
        
        self.trick_cards.append((player_id, card, as_zero))
        
        # Se tutti hanno giocato, risolvi il trick
        if len(self.trick_cards) == len(self.players):
            self._resolve_trick()
        else:
            # Passa al prossimo giocatore
            self.current_player = (self.current_player + 1) % len(self.players)
    
    def _resolve_trick(self):
        """Risolve il trick corrente"""
        # Trova la carta vincente
        winner_id = None
        max_strength = -1
        
        for player_id, card, as_zero in self.trick_cards:
            strength = card.get_strength(as_zero)
            if strength > max_strength:
                max_strength = strength
                winner_id = player_id
        
        # Assegna la vittoria
        self.players[winner_id].win_trick()
        
        # Registra nella storia
        self.history.append({
            'round': self.round_number,
            'cards': self.trick_cards.copy(),
            'winner': winner_id
        })
        
        # Prepara per il prossimo round
        self.trick_cards = []
        self.current_player = winner_id
        self.trick_starter = winner_id
        self.round_number += 1
    
    def is_game_over(self) -> bool:
        """Controlla se il gioco è finito"""
        return all(len(p.cards) == 0 for p in self.players)
    
    def evaluate_state(self, player_id: int) -> float:
        """Valuta lo stato dal punto di vista di un giocatore"""
        if self.is_game_over():
            player = self.players[player_id]
            # Vittoria se le mani vinte = bid, sconfitta altrimenti
            return 100.0 if player.tricks_won == player.bid else -100.0
        
        player = self.players[player_id]
        tricks_remaining = 5 - self.round_number + 1
        tricks_needed = player.bid - player.tricks_won
        
        # Euristica: quanto siamo vicini al nostro obiettivo?
        if tricks_needed < 0:
            # Abbiamo già vinto troppe mani
            return -50.0
        elif tricks_needed > tricks_remaining:
            # Non possiamo più raggiungere il nostro bid
            return -50.0
        else:
            # Siamo ancora in corsa
            # Bonus se siamo esattamente dove dovremmo essere
            ideal_progress = player.bid * (self.round_number - 1) / 5.0
            actual_progress = player.tricks_won
            diff = abs(ideal_progress - actual_progress)
            
            return 20.0 - diff * 10.0

class BiscaSolver:
    def __init__(self):
        self.transposition_table = {}
    
    def find_optimal_bid(self, cards: List[Card]) -> int:
        """Trova il bid ottimale date le carte iniziali"""
        # Analisi statistica delle carte
        strength_scores = []
        
        for card in cards:
            if card.is_joker():
                strength_scores.append(10)  # Il jolly è molto forte
            else:
                # Normalizza la forza in scala 0-10
                strength = card.get_strength()
                normalized = (strength - 100) / 310  # Min=100, Max=410
                strength_scores.append(normalized * 10)
        
        # Stima basata sulla forza media delle carte
        avg_strength = sum(strength_scores) / len(strength_scores)
        
        # Converti in bid (0-5)
        if avg_strength >= 8:
            return 4
        elif avg_strength >= 6:
            return 3
        elif avg_strength >= 4:
            return 2
        elif avg_strength >= 2:
            return 1
        else:
            return 0
    
    def minimax(self, state: GameState, depth: int, alpha: float, beta: float, 
                maximizing_player: int) -> Tuple[float, Optional[Tuple[Card, bool]]]:
        """Algoritmo minimax con alpha-beta pruning"""
        
        # Controllo terminale
        if depth == 0 or state.is_game_over():
            return state.evaluate_state(maximizing_player), None
        
        # Controlla la transposition table
        state_hash = self._hash_state(state)
        if state_hash in self.transposition_table:
            return self.transposition_table[state_hash]
        
        current_player = state.current_player
        is_maximizing = (current_player == maximizing_player)
        
        if is_maximizing:
            max_eval = float('-inf')
            best_move = None
            
            for card, as_zero in state.get_valid_moves(current_player):
                # Crea nuovo stato
                new_state = state.copy()
                new_state.play_card(current_player, card, as_zero)
                
                # Valuta ricorsivamente
                eval_score, _ = self.minimax(new_state, depth - 1, alpha, beta, maximizing_player)
                
                if eval_score > max_eval:
                    max_eval = eval_score
                    best_move = (card, as_zero)
                
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break  # Beta cutoff
            
            result = (max_eval, best_move)
        else:
            min_eval = float('inf')
            best_move = None
            
            for card, as_zero in state.get_valid_moves(current_player):
                # Crea nuovo stato
                new_state = state.copy()
                new_state.play_card(current_player, card, as_zero)
                
                # Valuta ricorsivamente
                eval_score, _ = self.minimax(new_state, depth - 1, alpha, beta, maximizing_player)
                
                if eval_score < min_eval:
                    min_eval = eval_score
                    best_move = (card, as_zero)
                
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break  # Alpha cutoff
            
            result = (min_eval, best_move)
        
        # Salva nella transposition table
        self.transposition_table[state_hash] = result
        
        return result
    
    def get_best_move(self, state: GameState, player_id: int, depth: int = 5) -> Tuple[Card, bool]:
        """Trova la mossa migliore per un giocatore"""
        self.transposition_table.clear()  # Pulisci la cache
        
        _, best_move = self.minimax(state, depth, float('-inf'), float('inf'), player_id)
        
        return best_move if best_move else state.get_valid_moves(player_id)[0]
    
    def _hash_state(self, state: GameState) -> str:
        """Crea un hash univoco per lo stato"""
        parts = []
        
        # Aggiungi le carte di ogni giocatore
        for p in state.players:
            card_strs = sorted([str(c) for c in p.cards])
            parts.append(f"P{p.id}:{','.join(card_strs)}:B{p.bid}:W{p.tricks_won}")
        
        # Aggiungi lo stato del trick corrente
        trick_strs = [f"{pid}-{card}-{az}" for pid, card, az in state.trick_cards]
        parts.append(f"T:{','.join(trick_strs)}")
        
        # Aggiungi info sul round
        parts.append(f"R{state.round_number}:CP{state.current_player}")
        
        return "|".join(parts)

# Esempio di utilizzo
def create_deck() -> List[Card]:
    """Crea un mazzo di 40 carte"""
    deck = []
    for suit in Suit:
        # Carte 1-7
        for value in range(1, 8):
            deck.append(Card(value, suit))
        # Figure: J=8, Q=9, K=10
        for value in range(8, 11):
            deck.append(Card(value, suit))
    return deck

def demo_game():
    """Demo completa del solver"""
    import random
    
    # Crea e mischia il mazzo
    deck = create_deck()
    random.shuffle(deck)
    
    # Distribuisci le carte (esempio con 2 giocatori)
    num_players = 2
    players = []
    
    for i in range(num_players):
        hand = deck[i*5:(i+1)*5]
        player = Player(i, hand)
        players.append(player)
    
    # Il solver suggerisce i bid ottimali
    solver = BiscaSolver()
    
    print("=== BISCA SOLVER ===\n")
    
    # Fase 1: Mostra carte e suggerisci bid
    for player in players:
        print(f"Giocatore {player.id} - Carte: {', '.join(str(c) for c in player.cards)}")
        optimal_bid = solver.find_optimal_bid(player.cards)
        player.bid = optimal_bid
        print(f"Bid suggerito: {optimal_bid}\n")
    
    # Crea lo stato del gioco
    game_state = GameState(players)
    
    print("=== INIZIO PARTITA ===\n")
    
    # Gioca tutti i 5 round
    while not game_state.is_game_over():
        print(f"\n--- Round {game_state.round_number} ---")
        print(f"Inizia il giocatore {game_state.current_player}")
        
        # Mostra lo stato attuale
        for p in game_state.players:
            print(f"Giocatore {p.id}: {p.tricks_won}/{p.bid} mani vinte")
        print()
        
        # Ogni giocatore gioca una carta
        tricks_in_round = []
        
        for _ in range(num_players):
            current_player = game_state.current_player
            player = game_state.players[current_player]
            
            print(f"\nTocca al giocatore {current_player}")
            print(f"Carte in mano: {', '.join(str(c) for c in player.cards)}")
            
            # Il solver suggerisce la mossa migliore
            best_card, as_zero = solver.get_best_move(game_state, current_player, depth=4)
            
            if best_card.is_joker():
                print(f"Gioca: {best_card} come {'0' if as_zero else 'carta più alta'}")
            else:
                print(f"Gioca: {best_card}")
            
            # Gioca la carta
            game_state.play_card(current_player, best_card, as_zero)
        
        # Mostra chi ha vinto il trick
        last_trick = game_state.history[-1]
        winner = last_trick['winner']
        print(f"\n=> Giocatore {winner} vince il trick!")
    
    # Risultati finali
    print("\n=== RISULTATI FINALI ===\n")
    
    winners = []
    losers = []
    
    for player in game_state.players:
        print(f"Giocatore {player.id}:")
        print(f"  Bid: {player.bid}")
        print(f"  Mani vinte: {player.tricks_won}")
        
        if player.tricks_won == player.bid:
            print(f"  Risultato: VITTORIA! ✓")
            winners.append(player.id)
        else:
            print(f"  Risultato: SCONFITTA ✗")
            losers.append(player.id)
        print()
    
    if winners:
        print(f"Vincitori: {', '.join(f'Giocatore {w}' for w in winners)}")
    if losers:
        print(f"Perdenti: {', '.join(f'Giocatore {l}' for l in losers)}")
    
    # Mostra la storia completa
    print("\n=== STORIA DEI TRICK ===")
    for trick in game_state.history:
        print(f"\nRound {trick['round']}:")
        for pid, card, as_zero in trick['cards']:
            if card.is_joker() and as_zero:
                print(f"  Giocatore {pid}: {card} (come 0)")
            else:
                print(f"  Giocatore {pid}: {card}")
        print(f"  Vincitore: Giocatore {trick['winner']}")

# Funzione per giocare una partita interattiva
def play_interactive():
    """Permette di giocare contro il solver"""
    import random
    
    deck = create_deck()
    random.shuffle(deck)
    
    # Giocatore 0 = umano, Giocatore 1 = AI
    players = []
    
    # Distribuisci carte
    human_hand = deck[0:5]
    ai_hand = deck[5:10]
    
    human = Player(0, human_hand)
    ai = Player(1, ai_hand)
    players = [human, ai]
    
    solver = BiscaSolver()
    
    print("=== BISCA - Gioca contro l'AI ===\n")
    
    # Mostra le tue carte
    print("Le tue carte:")
    for i, card in enumerate(human.cards):
        print(f"{i+1}. {card}")
    
    # Chiedi il bid
    while True:
        try:
            bid = int(input("\nQuante mani pensi di vincere? (0-5): "))
            if 0 <= bid <= 5:
                human.bid = bid
                break
            else:
                print("Inserisci un numero tra 0 e 5!")
        except ValueError:
            print("Inserisci un numero valido!")
    
    # AI sceglie il suo bid
    ai.bid = solver.find_optimal_bid(ai.cards)
    print(f"\nL'AI dichiara: {ai.bid}")
    
    # Crea stato del gioco
    game_state = GameState(players)
    
    print("\n=== INIZIO PARTITA ===")
    
    while not game_state.is_game_over():
        print(f"\n--- Round {game_state.round_number} ---")
        print(f"Tu: {human.tricks_won}/{human.bid} | AI: {ai.tricks_won}/{ai.bid}")
        
        for _ in range(2):
            current_player = game_state.current_player
            
            if current_player == 0:  # Turno umano
                print("\nLe tue carte:")
                valid_cards = []
                for i, card in enumerate(human.cards):
                    print(f"{i+1}. {card}")
                    valid_cards.append(card)
                
                while True:
                    try:
                        choice = int(input("Scegli una carta (numero): ")) - 1
                        if 0 <= choice < len(valid_cards):
                            chosen_card = valid_cards[choice]
                            
                            # Se è il jolly, chiedi come giocarlo
                            if chosen_card.is_joker():
                                joker_choice = input("Giocare il jolly come 0? (s/n): ").lower()
                                as_zero = joker_choice == 's'
                            else:
                                as_zero = False
                            
                            game_state.play_card(0, chosen_card, as_zero)
                            break
                        else:
                            print("Scelta non valida!")
                    except ValueError:
                        print("Inserisci un numero valido!")
            
            else:  # Turno AI
                print("\nL'AI sta pensando...")
                best_card, as_zero = solver.get_best_move(game_state, 1, depth=4)
                
                if best_card.is_joker():
                    print(f"L'AI gioca: {best_card} come {'0' if as_zero else 'carta più alta'}")
                else:
                    print(f"L'AI gioca: {best_card}")
                
                game_state.play_card(1, best_card, as_zero)
        
        # Mostra vincitore del trick
        last_trick = game_state.history[-1]
        winner = last_trick['winner']
        if winner == 0:
            print("\n=> Hai vinto il trick!")
        else:
            print("\n=> L'AI ha vinto il trick!")
    
    # Risultati finali
    print("\n=== RISULTATI FINALI ===")
    
    if human.tricks_won == human.bid:
        print(f"\nCOMPLIMENTI! Hai vinto!")
        print(f"Hai fatto esattamente {human.bid} mani come dichiarato!")
    else:
        print(f"\nHai perso!")
        print(f"Avevi dichiarato {human.bid} mani ma ne hai fatte {human.tricks_won}")
    
    if ai.tricks_won == ai.bid:
        print(f"\nL'AI ha vinto!")
        print(f"Ha fatto esattamente {ai.bid} mani come dichiarato!")
    else:
        print(f"\nL'AI ha perso!")
        print(f"Aveva dichiarato {ai.bid} mani ma ne ha fatte {ai.tricks_won}")

# Esegui la demo
if __name__ == "__main__":
    print("Cosa vuoi fare?")
    print("1. Vedere una demo automatica")
    print("2. Giocare contro l'AI")
    
    choice = input("\nScelta (1 o 2): ")
    
    if choice == "1":
        demo_game()
    elif choice == "2":
        play_interactive()
    else:
        print("Scelta non valida, eseguo la demo...")
        demo_game()