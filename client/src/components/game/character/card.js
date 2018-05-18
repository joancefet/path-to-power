import React from 'react';
import {Card, CardBody, Button, Progress} from 'reactstrap';
import {getStringColour} from '../../../helper';

class CharacterCard extends React.Component {
    constructor(props) {
        super(props);

        // Bug
        this.props.character.stats.health = this.props.character.stats.health || this.props.character.stats.health_max;
    }

    render() {
        return (
            <Card className="card-character">
                <div className="card-avatar" style={{backgroundColor: getStringColour(this.props.character.name)}}>
                    <div className="details">
                        <div className="name">{this.props.character.name}</div>
                        <div className="map">{this.props.character.location.map}</div>
                    </div>
                </div>
                <CardBody>
                    <Progress color="success" value={this.props.character.stats.health} max={this.props.character.stats.health_max}>
                        Health: {this.props.character.stats.health + '/' + this.props.character.stats.health_max}
                    </Progress>

                    <Progress multi>
                        <Progress bar color="info" value="50">XP: {this.props.character.stats.exp || 0}</Progress>
                        <Progress bar color="info" value="50">Total: {this.props.character.stats.exp_total || 0}</Progress>
                    </Progress>

                    <Progress color="warning" value="1" max="1">
                        Enhancement Points: {this.props.character.stats.enhPoints || 0}
                    </Progress>

                    <Progress color="danger" value="1" max="1">
                        Cash: {this.props.character.stats.money || 0}
                    </Progress>

                    <Progress color="primary" value="1" max="1">
                        Bank: {this.props.character.stats.bank || 0}
                    </Progress>
                    {
                        this.props.onSelect &&
                        <Button block color="primary" onClick={() => this.props.onSelect(this.props.character.name)}>Play Character</Button>
                    }
                </CardBody>
            </Card>
        );
    }
}

export default CharacterCard;
